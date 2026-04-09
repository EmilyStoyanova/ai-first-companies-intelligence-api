import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import fs from 'fs';
import { prisma } from '../../lib/prisma';
import { StorageService } from '../../services/storage';
import { getQueue, enqueueCrawlJob } from '../../lib/queue';
import { requireAuth } from '../../middleware/auth';
import { ExportService } from '../../services/export';

const router = Router();

const upload = multer({ dest: '/tmp/uploads/' });

function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//i, '');
  d = d.replace(/^www\./i, '');
  d = d.split('/')[0]; // remove paths
  return d;
}

function buildBaseUrl(domain: string): string {
  return `https://${domain}`;
}

const HEADER_WORDS = new Set(['domain', 'url', 'website', 'company', 'name', 'link']);

function isHeaderValue(value: string): boolean {
  return HEADER_WORDS.has(value.trim().toLowerCase());
}

function parseFile(filePath: string, ext: string): string[] {
  if (ext === '.csv') {
    const content = fs.readFileSync(filePath, 'utf-8');
    const result = Papa.parse<string[]>(content, { skipEmptyLines: true });
    return result.data
      .flatMap((row) => row)
      .filter(Boolean)
      .filter((v) => !isHeaderValue(v));
  } else {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    return rows
      .flatMap((row) => row)
      .filter(Boolean)
      .map(String)
      .filter((v) => !isHeaderValue(v));
  }
}

// GET /batches — list all batches for the authenticated tenant
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.user.tenantId;

  try {
    const batches = await prisma.crawlBatch.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(batches);
  } catch (err) {
    console.error('[batches/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /api/batches/upload:
 *   post:
 *     summary: Upload a CSV/Excel file of company domains
 *     tags: [Batches]
 *     parameters:
 *       - in: query
 *         name: force_recrawl
 *         schema:
 *           type: boolean
 *         description: Force re-crawl even if company was crawled within 30 days
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: CSV or Excel file with domain names
 *     responses:
 *       201:
 *         description: Batch created and jobs enqueued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 batchId: { type: string }
 *                 totalCompanies: { type: integer }
 *                 jobsEnqueued: { type: integer }
 *                 skipped: { type: integer }
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Weekly quota exceeded
 */
// POST /batches/upload
router.post(
  '/upload',
  requireAuth,
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.user.tenantId;
    const forceRecrawl = req.query.force_recrawl === 'true';

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
      res.status(400).json({ error: 'Only CSV and Excel files are supported' });
      return;
    }

    try {
      // Parse raw domains from file
      const rawValues = parseFile(req.file.path, ext);
      const domains = [...new Set(rawValues.map(normalizeDomain).filter(Boolean))];

      if (domains.length === 0) {
        res.status(400).json({ error: 'No valid domains found in file' });
        return;
      }

      // Check quota
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

      // Reset weekly usage if needed
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (tenant.usageResetAt < oneWeekAgo) {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: { weeklyUsage: 0, usageResetAt: new Date() },
        });
        tenant.weeklyUsage = 0;
      }

      if (tenant.weeklyUsage + domains.length > tenant.weeklyQuota) {
        res.status(429).json({
          error: 'Weekly quota exceeded',
          quota: tenant.weeklyQuota,
          used: tenant.weeklyUsage,
          requested: domains.length,
        });
        return;
      }

      // Save uploaded file
      const storedPath = StorageService.upload(
        `uploads/${tenantId}`,
        `${Date.now()}-${req.file.originalname}`,
        req.file.path
      );

      // Create batch
      const batch = await prisma.crawlBatch.create({
        data: {
          tenantId,
          filePath: storedPath,
          fileName: req.file.originalname,
          status: 'PROCESSING',
          totalCompanies: domains.length,
        },
      });

      const queue = await getQueue();
      let jobsEnqueued = 0;

      for (const domain of domains) {
        const baseUrl = buildBaseUrl(domain);

        // Upsert company
        const company = await prisma.company.upsert({
          where: { domain },
          create: { domain, baseUrl },
          update: {},
        });

        // Link to tenant
        await prisma.tenantCompany.upsert({
          where: { tenantId_companyId: { tenantId, companyId: company.id } },
          create: { tenantId, companyId: company.id, sourceBatchId: batch.id },
          update: { sourceBatchId: batch.id },
        });

        // Deduplication check
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const shouldSkip =
          !forceRecrawl &&
          company.lastCrawledAt !== null &&
          company.lastCrawledAt > thirtyDaysAgo;

        if (shouldSkip) {
          // Already fresh — count it as processed immediately
          await prisma.crawlBatch.update({
            where: { id: batch.id },
            data: { processedCompanies: { increment: 1 } },
          });
        } else {
          await enqueueCrawlJob(
            { companyId: company.id, domain, baseUrl, batchId: batch.id, tenantId },
            queue
          );
          jobsEnqueued++;
        }
      }

      // Update batch completion percentage
      const processed = domains.length - jobsEnqueued;
      await prisma.crawlBatch.update({
        where: { id: batch.id },
        data: {
          processedCompanies: processed,
          completionPercentage: (processed / domains.length) * 100,
          status: jobsEnqueued === 0 ? 'COMPLETED' : 'PROCESSING',
        },
      });

      // Increment tenant usage
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { weeklyUsage: { increment: jobsEnqueued } },
      });

      res.status(201).json({
        batchId: batch.id,
        totalCompanies: domains.length,
        jobsEnqueued,
        skipped: domains.length - jobsEnqueued,
      });
    } catch (err) {
      console.error('[batches/upload]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * @openapi
 * /api/batches/{id}:
 *   get:
 *     summary: Get batch status and progress
 *     tags: [Batches]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Batch details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Batch'
 *       404:
 *         description: Batch not found
 */
// GET /batches/:id
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const tenantId = req.user.tenantId;

  try {
    const batch = await prisma.crawlBatch.findFirst({
      where: { id, tenantId },
    });

    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    // Recalculate completion percentage from DB
    const processed = batch.processedCompanies;
    const total = batch.totalCompanies;
    const percentage = total > 0 ? (processed / total) * 100 : 0;

    res.json({ ...batch, completionPercentage: percentage });
  } catch (err) {
    console.error('[batches/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /api/batches/{id}/companies:
 *   get:
 *     summary: List companies in a batch (paginated)
 *     tags: [Batches]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Paginated list of companies with profiles
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Company'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *                     total: { type: integer }
 *                     pages: { type: integer }
 */
// GET /batches/:id/companies
router.get('/:id/companies', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const tenantId = req.user.tenantId;
  const page = parseInt(String(req.query.page || '1'), 10);
  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
  const skip = (page - 1) * limit;

  try {
    const batch = await prisma.crawlBatch.findFirst({ where: { id, tenantId } });
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    const [total, companies] = await Promise.all([
      prisma.company.count({
        where: {
          tenantCompanies: { some: { tenantId, sourceBatchId: id } },
        },
      }),
      prisma.company.findMany({
        where: {
          tenantCompanies: { some: { tenantId, sourceBatchId: id } },
        },
        include: { profile: true },
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    res.json({
      data: companies,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[batches/:id/companies]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @openapi
 * /api/batches/{id}/download:
 *   get:
 *     summary: Download batch export as CSV or XLSX
 *     tags: [Batches]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [csv, xlsx]
 *           default: csv
 *     responses:
 *       200:
 *         description: File download
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *               format: binary
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Batch not found
 */
// GET /batches/:id/download
router.get('/:id/download', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const tenantId = req.user.tenantId;
  const format = (req.query.format as string) || 'csv';

  try {
    const batch = await prisma.crawlBatch.findFirst({ where: { id, tenantId } });
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    // Generate export on-the-fly or use cached
    const exportPath = await ExportService.exportBatch(id, tenantId, format as 'csv' | 'xlsx');

    const mime = format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv';
    const fileName = `batch-${id}.${format}`;

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(StorageService.read(exportPath));
  } catch (err) {
    console.error('[batches/:id/download]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /batches/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const tenantId = req.user.tenantId;

  try {
    const batch = await prisma.crawlBatch.findFirst({ where: { id, tenantId } });
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    // Unlink tenant-company associations for this batch, then delete the batch
    await prisma.$transaction([
      prisma.tenantCompany.deleteMany({ where: { sourceBatchId: id } }),
      prisma.crawlBatch.delete({ where: { id } }),
    ]);

    res.status(204).send();
  } catch (err) {
    console.error('[batches/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
