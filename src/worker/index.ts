import 'dotenv/config';
import { getQueue, QUEUES, CrawlCompanyPayload, DiscoverPersonaPayload, enqueueCrawlJob, stopQueue } from '../lib/queue';
import { prisma } from '../lib/prisma';
import { crawlCompany } from './crawl';
import { extractProfile } from '../services/extraction';
import { discoverSites } from '../services/discovery';
import PgBoss from 'pg-boss';

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

async function processJob(jobs: PgBoss.JobWithMetadata<CrawlCompanyPayload>[]): Promise<void> {
  for (const job of jobs) {
    await processSingleJob(job);
  }
}

async function processSingleJob(job: PgBoss.JobWithMetadata<CrawlCompanyPayload>): Promise<void> {
  const { companyId, domain, baseUrl, batchId, tenantId } = job.data;
  console.log(`[worker] processing ${domain} (${companyId})`);

  // Mark company as crawling
  await prisma.company.update({
    where: { id: companyId },
    data: { crawlStatus: 'CRAWLING' },
  });

  try {
    // 1. Crawl pages
    const pages = await crawlCompany(baseUrl);

    if (pages.length === 0) {
      // Host is unreachable — mark failed immediately, no retry
      await prisma.company.update({
        where: { id: companyId },
        data: { crawlStatus: 'FAILED' },
      });
      await updateBatchProgress(batchId);
      console.log(`[worker] skipped ${domain} — unreachable (no pages)`);
      return;
    }

    // 2. Save raw data
    await prisma.rawCompanyProfile.createMany({
      data: pages.map((p) => ({
        companyId,
        baseUrl,
        specificUrl: p.url,
        data: { text: p.text, emails: p.emails, phones: p.phones },
      })),
      skipDuplicates: false,
    });

    // 3. Extract processed profile
    const profile = extractProfile(pages);

    // 4. Upsert CompanyProfile
    await prisma.companyProfile.upsert({
      where: { companyId },
      create: {
        companyId,
        name: profile.name,
        description: profile.description,
        location: profile.location,
        emails: profile.emails,
        phones: profile.phones,
        services: profile.services,
        team: profile.team as unknown as import('@prisma/client').Prisma.InputJsonValue,
        history: profile.history,
        socialLinks: profile.socialLinks,
        completionScore: profile.completionScore,
      },
      update: {
        name: profile.name,
        description: profile.description,
        location: profile.location,
        emails: profile.emails,
        phones: profile.phones,
        services: profile.services,
        team: profile.team as unknown as import('@prisma/client').Prisma.InputJsonValue,
        history: profile.history,
        socialLinks: profile.socialLinks,
        completionScore: profile.completionScore,
      },
    });

    // 5. Update company status
    await prisma.company.update({
      where: { id: companyId },
      data: { crawlStatus: 'COMPLETED', lastCrawledAt: new Date(), name: profile.name },
    });

    console.log(`[worker] done ${domain} — score: ${profile.completionScore}`);
    await updateBatchProgress(batchId);
  } catch (err) {
    console.error(`[worker] failed ${domain}:`, err);

    const retryLimit = 3;
    const isFinalAttempt = (job.retryCount ?? 0) >= retryLimit - 1;

    await prisma.company.update({
      where: { id: companyId },
      data: { crawlStatus: isFinalAttempt ? 'FAILED' : 'PENDING' },
    });

    // Only count toward batch progress on the final failure, not each retry
    if (isFinalAttempt) {
      await updateBatchProgress(batchId);
    }

    throw err; // Let pg-boss handle retry
  }
}

async function updateBatchProgress(batchId: string): Promise<void> {
  const batch = await prisma.crawlBatch.findUnique({
    where: { id: batchId },
    select: { totalCompanies: true, processedCompanies: true },
  });
  if (!batch) return;

  const newProcessed = batch.processedCompanies + 1;
  const percentage = batch.totalCompanies > 0
    ? (newProcessed / batch.totalCompanies) * 100
    : 0;
  const status = newProcessed >= batch.totalCompanies ? 'COMPLETED' : 'PROCESSING';

  await prisma.crawlBatch.update({
    where: { id: batchId },
    data: {
      processedCompanies: newProcessed,
      completionPercentage: percentage,
      status,
    },
  });
}

async function processDiscoverJob(
  job: PgBoss.JobWithMetadata<DiscoverPersonaPayload>
): Promise<void> {
  const { batchId, tenantId, persona, location, keywords, maxResults } = job.data;
  console.log(`[worker/discover] starting discovery: "${persona}" in "${location}"`);

  try {
    const sites = await discoverSites({ persona, location, keywords, maxResults });

    // Deduplicate by domain
    const seen = new Set<string>();
    const unique = sites.filter((s) => {
      if (seen.has(s.domain)) return false;
      seen.add(s.domain);
      return true;
    });

    if (unique.length === 0) {
      console.log(`[worker/discover] no sites found for "${persona}" in "${location}"`);
      await prisma.crawlBatch.update({
        where: { id: batchId },
        data: { status: 'COMPLETED', totalCompanies: 0, completionPercentage: 100 },
      });
      return;
    }

    console.log(`[worker/discover] found ${unique.length} sites`);

    // Update batch with the actual count
    await prisma.crawlBatch.update({
      where: { id: batchId },
      data: { totalCompanies: unique.length },
    });

    const crawlQueue = await getQueue();

    for (const site of unique) {
      const baseUrl = `https://${site.domain}`;

      const company = await prisma.company.upsert({
        where: { domain: site.domain },
        create: { domain: site.domain, baseUrl, name: site.title },
        update: {},
      });

      await prisma.tenantCompany.upsert({
        where: { tenantId_companyId: { tenantId, companyId: company.id } },
        create: { tenantId, companyId: company.id, sourceBatchId: batchId },
        update: { sourceBatchId: batchId },
      });

      await enqueueCrawlJob(
        { companyId: company.id, domain: site.domain, baseUrl, batchId, tenantId },
        crawlQueue
      );
    }

    // Increment tenant weekly usage
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { weeklyUsage: { increment: unique.length } },
    });

    console.log(`[worker/discover] enqueued ${unique.length} crawl jobs for batch ${batchId}`);
  } catch (err) {
    console.error('[worker/discover] failed:', err);
    await prisma.crawlBatch.update({
      where: { id: batchId },
      data: { status: 'FAILED' },
    });
    throw err;
  }
}

async function main(): Promise<void> {
  console.log('[worker] starting...');
  const queue = await getQueue();

  queue.work<CrawlCompanyPayload>(
    QUEUES.CRAWL_COMPANY,
    { batchSize: CONCURRENCY, includeMetadata: true },
    processJob
  );

  queue.work<DiscoverPersonaPayload>(
    QUEUES.DISCOVER_PERSONA,
    { batchSize: 1, includeMetadata: true },
    async (jobs) => {
      for (const job of jobs) await processDiscoverJob(job);
    }
  );

  console.log(`[worker] listening on queues "${QUEUES.CRAWL_COMPANY}", "${QUEUES.DISCOVER_PERSONA}" (concurrency: ${CONCURRENCY})`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[worker] received ${signal}, shutting down...`);
    await stopQueue();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[worker] fatal error:', err);
  process.exit(1);
});
