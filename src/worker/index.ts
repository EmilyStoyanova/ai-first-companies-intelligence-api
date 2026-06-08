import 'dotenv/config';
import { getQueue, QUEUES, CrawlCompanyPayload, DiscoverPersonaPayload, PersonalizeCompanyPayload, enqueueCrawlJob, enqueuePersonalizeJob, stopQueue } from '../lib/queue';
import { prisma } from '../lib/prisma';
import { crawlCompany, detectBotProtection, BOT_CRAWL_NOTE } from './crawl';
import { extractProfile } from '../services/extraction';
import { enrichSocialLinks } from '../services/socialEnrichment';
import { discoverSites, SearchProviderError } from '../services/discovery';
import { checkFreshness } from '../lib/freshness';
import { generatePersonalizedContent } from '../services/personalization';
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

    // 1b. Bot-protection check — if detected, mark BLOCKED and stop without extracting
    const { blocked, indicator } = detectBotProtection(pages);
    if (blocked) {
      await prisma.company.update({
        where: { id: companyId },
        data: { crawlStatus: 'BLOCKED', crawlNote: BOT_CRAWL_NOTE },
      });
      await updateBatchProgress(batchId);
      console.log(`[worker] blocked ${domain} — bot protection detected (${indicator})`);
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

    // 3b. Enrich missing social links from search (best-effort, non-critical)
    try {
      const enrichedSocial = await enrichSocialLinks(profile, domain);
      if (Object.keys(enrichedSocial).length > 0) {
        const hadSocial = Object.keys(profile.socialLinks).length > 0;
        profile.socialLinks = { ...profile.socialLinks, ...enrichedSocial };
        if (!hadSocial) profile.completionScore += 5; // FIELD_WEIGHTS.socialLinks
      }
    } catch { /* non-critical */ }

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

    // 6. Enqueue personalization — separate queue with lower concurrency for Groq rate limits
    const pQueue = await getQueue();
    await enqueuePersonalizeJob({ companyId }, pQueue);
  } catch (err) {
    console.error(`[worker] failed ${domain}:`, err);

    const retryLimit = 3;
    const isFinalAttempt = (job.retryCount ?? 0) >= retryLimit - 1;

    // Use updateMany with a guard so a stale/concurrent retry job never downgrades
    // a company that was already successfully completed by a parallel job.
    await prisma.company.updateMany({
      where: { id: companyId, crawlStatus: { not: 'COMPLETED' } },
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
  // Atomic increment — avoids read-modify-write race with concurrent workers
  let batch: { totalCompanies: number; processedCompanies: number };
  try {
    batch = await prisma.crawlBatch.update({
      where: { id: batchId },
      data: { processedCompanies: { increment: 1 } },
      select: { totalCompanies: true, processedCompanies: true },
    });
  } catch (err: unknown) {
    // Batch was deleted or never existed — skip progress update silently.
    // A missing batch must not propagate as a crawl failure.
    if ((err as { code?: string }).code === 'P2025') {
      console.warn(`[worker] batch ${batchId} not found; skipping progress update`);
      return;
    }
    throw err;
  }

  const percentage = batch.totalCompanies > 0
    ? (batch.processedCompanies / batch.totalCompanies) * 100
    : 0;
  const status = batch.processedCompanies >= batch.totalCompanies ? 'COMPLETED' : 'PROCESSING';

  await prisma.crawlBatch.update({
    where: { id: batchId },
    data: { completionPercentage: percentage, status },
  });
}

async function processDiscoverJob(
  job: PgBoss.JobWithMetadata<DiscoverPersonaPayload>
): Promise<void> {
  const { batchId, tenantId, persona, location, keywords, maxResults, forceRecrawl } = job.data;
  console.log(`[worker/discover] starting discovery: "${persona}" in "${location}"`);

  try {
    const allSites = await discoverSites({ persona, location, keywords, maxResults });

    // Cap to maxResults — quota was already checked against this limit at request time
    const limit = maxResults ?? 50;
    const keptSites = allSites.filter((s) => s.status === 'kept').slice(0, limit);

    // Persist all candidates (kept + filtered + blocked) for the UI
    if (allSites.length > 0) {
      await prisma.discoveryCandidate.createMany({
        data: allSites.map((s) => ({
          batchId,
          domain: s.domain,
          url: s.url,
          title: s.title,
          snippet: s.snippet,
          status: s.status.toUpperCase() as 'KEPT' | 'FILTERED' | 'BLOCKED',
        })),
        skipDuplicates: true,
      });
    }

    if (keptSites.length === 0) {
      console.log(`[worker/discover] no sites found for "${persona}" in "${location}"`);
      await prisma.crawlBatch.update({
        where: { id: batchId },
        data: { status: 'COMPLETED', totalCompanies: 0, completionPercentage: 100 },
      });
      return;
    }

    console.log(`[worker/discover] kept=${keptSites.length} total=${allSites.length}`);

    // Update batch with the count of sites to crawl (before dedup — will be corrected below)
    await prisma.crawlBatch.update({
      where: { id: batchId },
      data: { totalCompanies: keptSites.length },
    });

    const crawlQueue = await getQueue();
    let jobsEnqueued = 0;
    let skippedFresh = 0;

    for (const site of keptSites) {
      const baseUrl = `https://${site.domain}`;

      // upsert returns existing record unchanged (update: {}) so lastCrawledAt is current
      // include profile so freshness check can evaluate quality
      const company = await prisma.company.upsert({
        where: { domain: site.domain },
        create: { domain: site.domain, baseUrl, name: site.title },
        update: {},
        include: { profile: true },
      });

      await prisma.tenantCompany.createMany({
        data: [{ tenantId, companyId: company.id, sourceBatchId: batchId }],
        skipDuplicates: true,
      });

      const freshness = checkFreshness(company, forceRecrawl ?? false);

      if (freshness.skip) {
        console.log(`[discover] skipped fresh company ${site.domain} — ${freshness.reason}`);
        skippedFresh++;
        await updateBatchProgress(batchId);
      } else {
        console.log(`[discover] recrawling ${site.domain} — ${freshness.reason}`);
        await enqueueCrawlJob(
          { companyId: company.id, domain: site.domain, baseUrl, batchId, tenantId },
          crawlQueue
        );
        jobsEnqueued++;
      }
    }

    // Increment tenant weekly usage by accepted (not skipped) companies
    if (jobsEnqueued > 0) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { weeklyUsage: { increment: jobsEnqueued } },
      });
    }

    console.log(`[worker/discover] enqueued=${jobsEnqueued} skippedFresh=${skippedFresh} for batch ${batchId}`);
  } catch (err) {
    if (err instanceof SearchProviderError) {
      // Billing / quota / auth / rate-limit from Brave — fail this batch without retrying.
      // Store the note inside searchQuery so the frontend can surface it without a schema change.
      const errorNote = `Search provider quota/billing error. Brave Search returned HTTP ${err.statusCode}.`;
      console.error(
        `[worker/discover] provider error HTTP ${err.statusCode} for batch ${batchId} ` +
        `— query="${err.query}" — ${errorNote}`,
      );
      const batchRecord = await prisma.crawlBatch.findUnique({
        where: { id: batchId },
        select: { searchQuery: true },
      });
      const sq = (batchRecord?.searchQuery ?? {}) as Record<string, unknown>;
      await prisma.crawlBatch.update({
        where: { id: batchId },
        data: { status: 'FAILED', searchQuery: { ...sq, _errorNote: errorNote } },
      });
      return; // Do not re-throw — provider error is not retryable via pg-boss
    }

    console.error('[worker/discover] failed:', err);
    await prisma.crawlBatch.update({
      where: { id: batchId },
      data: { status: 'FAILED' },
    });
    throw err; // Other errors — let pg-boss retry
  }
}

async function processPersonalizeJob(
  job: PgBoss.JobWithMetadata<PersonalizeCompanyPayload>
): Promise<void> {
  const { companyId } = job.data;

  const profile = await prisma.companyProfile.findUnique({ where: { companyId } });
  if (!profile) {
    console.log(`[worker/personalize] No profile for ${companyId} — skipping`);
    return;
  }

  const result = await generatePersonalizedContent({
    name:        profile.name        ?? undefined,
    description: profile.description ?? undefined,
    location:    profile.location    ?? undefined,
    services:    Array.isArray(profile.services) ? (profile.services as string[])                             : [],
    team:        Array.isArray(profile.team)     ? (profile.team as Array<{ name: string; position?: string }>) : [],
    history:     profile.history     ?? undefined,
    emails:      Array.isArray(profile.emails)   ? (profile.emails as string[])                               : [],
  });

  if (!result) return;

  await prisma.personalizedContent.upsert({
    where:  { companyId },
    create: { companyId, ...result },
    update: result,
  });

  console.log(`[worker/personalize] Saved content for ${companyId}`);
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

  queue.work<PersonalizeCompanyPayload>(
    QUEUES.PERSONALIZE_COMPANY,
    { batchSize: 2, includeMetadata: true },
    async (jobs) => {
      for (const job of jobs) await processPersonalizeJob(job);
    }
  );

  console.log(`[worker] listening on queues "${QUEUES.CRAWL_COMPANY}", "${QUEUES.DISCOVER_PERSONA}", "${QUEUES.PERSONALIZE_COMPANY}" (concurrency: ${CONCURRENCY})`);

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
