import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';
import { ExportService } from '../../services/export';

const router = Router();

/**
 * @openapi
 * /api/exports/{batchId}:
 *   get:
 *     summary: Generate an export for a batch and get the download URL
 *     tags: [Exports]
 *     parameters:
 *       - in: path
 *         name: batchId
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
 *         description: Export generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 downloadUrl: { type: string }
 *                 exportPath: { type: string }
 *       404:
 *         description: Batch not found
 */
// GET /exports/:batchId  — triggers export generation, returns download URL
router.get('/:batchId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const batchId = String(req.params.batchId);
  const tenantId = req.user.tenantId;
  const format = (req.query.format as string) || 'csv';

  try {
    const batch = await prisma.crawlBatch.findFirst({ where: { id: batchId, tenantId } });
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    const exportPath = await ExportService.exportBatch(batchId, tenantId, format as 'csv' | 'xlsx');

    // Save exportPath back on the batch
    await prisma.crawlBatch.update({
      where: { id: batchId },
      data: { exportPath },
    });

    const downloadUrl = `/api/batches/${batchId}/download?format=${format}`;
    res.json({ downloadUrl, exportPath });
  } catch (err) {
    console.error('[exports/:batchId]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
