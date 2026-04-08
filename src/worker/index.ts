import 'dotenv/config';
import { getQueue, QUEUES, CrawlCompanyPayload, stopQueue } from '../lib/queue';
import { prisma } from '../lib/prisma';
import { crawlCompany } from './crawl';
import { extractProfile } from '../services/extraction';
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
      throw new Error(`No pages crawled for ${domain}`);
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
        team: profile.team,
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
        team: profile.team,
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

async function main(): Promise<void> {
  console.log('[worker] starting...');
  const queue = await getQueue();

  queue.work<CrawlCompanyPayload>(
    QUEUES.CRAWL_COMPANY,
    { batchSize: CONCURRENCY, includeMetadata: true },
    processJob
  );

  console.log(`[worker] listening on queue "${QUEUES.CRAWL_COMPANY}" (concurrency: ${CONCURRENCY})`);

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
