import 'dotenv/config';
import { getQueue, QUEUES, CrawlCompanyPayload, DiscoverPersonaPayload, PersonalizeCompanyPayload, enqueueCrawlJob, enqueuePersonalizeJob, stopQueue } from '../lib/queue';
import { prisma } from '../lib/prisma';
import { crawlCompany, detectBotProtection, BOT_CRAWL_NOTE } from './crawl';
import { extractProfile, isGenericAuthName } from '../services/extraction';
import { enrichSocialLinks } from '../services/socialEnrichment';
import { enrichAddress } from '../services/addressEnrichment';
import { validateAddress } from '../services/addressValidation';
import { validateEmails, selectPageForValidation } from '../services/emailValidation';
import { validateServices, selectServicesPage } from '../services/servicesValidation';
import { runLoginFallbackEnrichment } from '../services/loginFallbackEnrichment';
import { discoverSites, SearchProviderError } from '../services/discovery';
import { checkFreshness } from '../lib/freshness';
import { generatePersonalizedContent } from '../services/personalization';
import { generateCampaignEmail } from '../services/campaignEmailGeneration';
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

    console.log(`[worker:profile] ${domain} — pages(${pages.length})=${JSON.stringify(pages.map(p => p.url))} emails(${profile.emails.length})=${JSON.stringify(profile.emails)}`);

    // 3b. Enrich missing social links from search (best-effort, non-critical)
    try {
      const enrichedSocial = await enrichSocialLinks(profile, domain);
      if (Object.keys(enrichedSocial).length > 0) {
        const hadSocial = Object.keys(profile.socialLinks).length > 0;
        profile.socialLinks = { ...profile.socialLinks, ...enrichedSocial };
        if (!hadSocial) profile.completionScore += 5; // FIELD_WEIGHTS.socialLinks
      }
    } catch { /* non-critical */ }

    // 3c. Login-page fallback enrichment — when normal extraction yielded very little
    // (score < 30 or no name) and the homepage is a login wall, use the visible logo
    // to identify the company and discover social profiles via secondary search.
    const isLoginProtected = pages.some((p) => p.loginProtected);
    let loginFallback: Awaited<ReturnType<typeof runLoginFallbackEnrichment>> | null = null;

    // Treat a generic auth title ("login", "вход", "portal" …) the same as a missing name:
    // the page title of a login wall is never a real company name.
    const nameIsMissingOrGeneric = !profile.name || isGenericAuthName(profile.name);

    if (isLoginProtected && (profile.completionScore < 30 || nameIsMissingOrGeneric)) {
      try {
        loginFallback = await runLoginFallbackEnrichment(pages, domain);
        console.log(
          `[worker:login-fallback] ${domain} — name="${loginFallback.companyNameFromLogo ?? 'n/a'}" ` +
          `confidence=${loginFallback.logoNameConfidence}`,
        );
        // Merge fallback data into live profile.
        // Allow OCR name to replace a generic auth title (e.g. "login" → "Walltopia").
        if (nameIsMissingOrGeneric && loginFallback.enrichedName)
          profile.name = loginFallback.enrichedName;
        if (!profile.description && loginFallback.enrichedDescription)
          profile.description = loginFallback.enrichedDescription;
        if (Object.keys(loginFallback.enrichedSocialLinks).length > 0)
          profile.socialLinks = { ...loginFallback.enrichedSocialLinks, ...profile.socialLinks };
        profile.completionScore = Math.min(100, profile.completionScore + loginFallback.scoreBonus);
      } catch { /* non-critical — fallback must never break the crawl pipeline */ }
    }

    // 3d. Address validation — enrichAddress gathers search candidates first;
    // validateAddress uses both the website candidate and search candidates.
    // enrichAddress result serves as fallback if AI validation fails or finds nothing.
    let aiFoundAddress = false;
    let enrichResult: Awaited<ReturnType<typeof enrichAddress>> | undefined;
    try {
      enrichResult = await enrichAddress(profile, domain);
    } catch { /* non-critical */ }

    try {
      console.log(`[worker:address-validation] ${domain} GROQ_API_KEY=${!!process.env.GROQ_API_KEY}`);
      const addrVal = await validateAddress(
        profile.name ?? domain,
        domain,
        profile.location ?? '',
        enrichResult?.searchCandidates ?? [],
      );
      if (addrVal.primary) {
        const hadLocation = !!profile.location;
        profile.location = addrVal.primary.full_address;
        aiFoundAddress = true;
        if (!hadLocation) profile.completionScore = Math.min(100, profile.completionScore + 10);
        console.log(
          `[worker:address-validation] ${domain} → "${addrVal.primary.full_address}" source=${addrVal.primary.source} (confidence=${addrVal.primary.confidence})`,
        );
      }
      if (addrVal.notes) {
        console.log(`[worker:address-validation] ${domain} notes="${addrVal.notes}"`);
      }
    } catch (e) {
      console.warn(`[worker:address-validation] ${domain} failed:`, e);
    }

    // Fallback: use enrichAddress result directly if AI found nothing
    if (!aiFoundAddress && enrichResult?.location) {
      const hadLocation = !!profile.location;
      profile.location = enrichResult.location;
      if (!hadLocation) profile.completionScore = Math.min(100, profile.completionScore + 10);
    }

    // 3e. Email validation — AI-assisted filtering/discovery of emails.
    // Runs against the best available contact page HTML. If validation returns
    // verified results (confidence ≥ 70) they replace the regex-extracted set;
    // lower-confidence candidates are logged but not stored.
    try {
      console.log(`[worker:email-validation] ${domain} GROQ_API_KEY=${!!process.env.GROQ_API_KEY}`);
      const validationPage = selectPageForValidation(pages);
      if (validationPage) {
        const emailResult = await validateEmails(
          profile.name ?? domain,
          domain,
          validationPage.url,
          validationPage.html,
        );
        if (emailResult.unverified.length > 0) {
          console.log(
            `[worker:email-validation] ${domain} unverified=${JSON.stringify(emailResult.unverified.map((e) => `${e.email}(${e.confidence})`))}`,
          );
        }
        if (emailResult.verified.length > 0) {
          profile.emails = emailResult.verified;
          console.log(`[worker:email-validation] ${domain} verified=${JSON.stringify(emailResult.verified)}`);
        } else {
          console.log(`[worker:email-validation] ${domain} no verified emails — keeping regex results`);
        }
        if (emailResult.notes) {
          console.log(`[worker:email-validation] ${domain} notes="${emailResult.notes}"`);
        }
      }
    } catch (e) {
      console.warn(`[worker:email-validation] ${domain} failed — keeping regex results:`, e);
    }

    // 3f. Services validation — AI extraction of services, brands, industry, and target customers.
    // Uses the services/about page when available. On success the profile services list is
    // replaced; on no_services_found the pre-existing regex-extracted list is preserved as fallback.
    let aiRepresentedBrands: string[] = [];
    let aiPrimaryIndustry: string | undefined;
    let aiTargetCustomers: string | undefined;
    try {
      const svcPage = selectServicesPage(pages);
      if (svcPage) {
        const svcResult = await validateServices(
          profile.name ?? domain,
          domain,
          svcPage.url,
          svcPage.html,
        );
        if (svcResult.services.length > 0) {
          profile.services = svcResult.services;
          console.log(
            `[worker:services-validation] ${domain} → ${svcResult.services.length} services (confidence=${svcResult.confidence})`,
          );
        } else {
          console.log(`[worker:services-validation] ${domain} no services found — keeping extracted results`);
        }
        aiRepresentedBrands = svcResult.represented_brands;
        aiPrimaryIndustry   = svcResult.primary_industry;
        aiTargetCustomers   = svcResult.target_customers;
        if (svcResult.notes) {
          console.log(`[worker:services-validation] ${domain} notes="${svcResult.notes}"`);
        }
      }
    } catch (e) {
      console.warn(`[worker:services-validation] ${domain} failed — keeping extracted results:`, e);
    }

    // 3g. Campaign email generation — tenant-specific B2B outreach email.
    // Runs only when the profile has enough data and the tenant has sender info configured.
    // Non-critical — failure never stops the crawl pipeline.
    let campaignEmailText: string | undefined;
    try {
      const hasSufficientProfile = !!(profile.name && (profile.description || profile.services.length > 0));
      if (hasSufficientProfile) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            name: true,
            website: true,
            contactPersonName: true,
            contactPersonTitle: true,
            contactPersonEmail: true,
            contactPersonPhone: true,
          },
        });
        const hasSenderInfo = !!tenant?.contactPersonName;
        if (hasSenderInfo && tenant) {
          // Fallback to first user email if tenant.contactPersonEmail is not set
          let senderEmail: string = tenant.contactPersonEmail ?? '';
          if (!senderEmail) {
            const firstUser = await prisma.user.findFirst({
              where: { tenantId },
              select: { email: true },
              orderBy: { createdAt: 'asc' },
            });
            senderEmail = firstUser?.email ?? '';
          }

          const result = await generateCampaignEmail({
            targetName:        profile.name ?? domain,
            targetDomain:      domain,
            targetDescription: profile.description ?? '',
            targetServices:    profile.services,
            targetLocation:    profile.location ?? '',
            targetTeam:        Array.isArray(profile.team) ? profile.team as Array<{ name: string; position?: string }> : [],
            senderCompanyName: tenant.name,
            senderWebsite:     tenant.website ?? '',
            senderContactName: tenant.contactPersonName!,
            senderContactTitle: tenant.contactPersonTitle ?? '',
            senderContactEmail: senderEmail,
            senderContactPhone: tenant.contactPersonPhone ?? '',
          });
          if (result) {
            campaignEmailText = result;
            console.log(`[worker:campaign-email] ${domain} — generated (${result.length} chars)`);
          }
        } else {
          console.log(`[worker:campaign-email] ${domain} — skipped (tenant sender info not configured)`);
        }
      } else {
        console.log(`[worker:campaign-email] ${domain} — skipped (insufficient profile data)`);
      }
    } catch (e) {
      console.warn(`[worker:campaign-email] ${domain} failed — skipping:`, e);
    }

    // 4. Upsert CompanyProfile — preserve existing emails/phones if the new crawl found none.
    // A retry crawl that misses the contact page must not overwrite verified contact data.
    const existingProfile = await prisma.companyProfile.findUnique({
      where: { companyId },
      select: { emails: true, phones: true, name: true, companyNameFromLogo: true },
    });
    const existingEmails = Array.isArray(existingProfile?.emails) ? existingProfile.emails as string[] : [];
    const existingPhones = Array.isArray(existingProfile?.phones) ? existingProfile.phones as string[] : [];
    // Name resolution: new crawl wins; if it found nothing, fall back in order:
    //   1. previously OCR-extracted logo name (if existingName is generic or missing)
    //   2. existing real name from a prior crawl
    // A stale generic auth name ("login"/"вход"/"portal") is explicitly nulled out so that
    // Prisma actually clears it rather than preserving it (Prisma ignores `undefined` on update).
    const existingName = existingProfile?.name as string | null | undefined;
    const existingLogoName = existingProfile?.companyNameFromLogo as string | null | undefined;
    const upsertName = profile.name != null
      ? profile.name
      : isGenericAuthName(existingName)
        ? (existingLogoName || null)
        : (existingName ?? existingLogoName ?? null);
    const upsertEmails = profile.emails.length > 0 ? profile.emails : existingEmails;
    const upsertPhones = profile.phones.length > 0 ? profile.phones : existingPhones;
    // Adjust score if falling back to preserved contact data
    let upsertScore = profile.completionScore;
    if (upsertEmails.length > 0 && profile.emails.length === 0) upsertScore = Math.min(100, upsertScore + 15);
    if (upsertPhones.length > 0 && profile.phones.length === 0) upsertScore = Math.min(100, upsertScore + 10);

    await prisma.companyProfile.upsert({
      where: { companyId },
      create: {
        companyId,
        name: upsertName,
        description: profile.description,
        location: profile.location,
        emails: upsertEmails,
        phones: upsertPhones,
        services: profile.services,
        representedBrands: aiRepresentedBrands,
        primaryIndustry:   aiPrimaryIndustry,
        targetCustomers:   aiTargetCustomers,
        team: profile.team as unknown as import('@prisma/client').Prisma.InputJsonValue,
        history: profile.history,
        socialLinks: profile.socialLinks,
        completionScore: upsertScore,
        loginProtected:      isLoginProtected,
        logoSourceUrl:       loginFallback?.logoSourceUrl       ?? undefined,
        companyNameFromLogo: loginFallback?.companyNameFromLogo ?? undefined,
        sloganFromLogo:      loginFallback?.sloganFromLogo      ?? undefined,
        logoNameConfidence:  loginFallback?.logoNameConfidence  ?? 0,
        campaignEmail:       campaignEmailText,
      },
      update: {
        name: upsertName,
        description: profile.description,
        location: profile.location,
        emails: upsertEmails,
        phones: upsertPhones,
        services: profile.services,
        representedBrands: aiRepresentedBrands,
        primaryIndustry:   aiPrimaryIndustry,
        targetCustomers:   aiTargetCustomers,
        team: profile.team as unknown as import('@prisma/client').Prisma.InputJsonValue,
        history: profile.history,
        socialLinks: profile.socialLinks,
        completionScore: upsertScore,
        loginProtected:      isLoginProtected,
        logoSourceUrl:       loginFallback?.logoSourceUrl       ?? undefined,
        companyNameFromLogo: loginFallback?.companyNameFromLogo ?? undefined,
        sloganFromLogo:      loginFallback?.sloganFromLogo      ?? undefined,
        logoNameConfidence:  loginFallback?.logoNameConfidence  ?? 0,
        ...(campaignEmailText !== undefined ? { campaignEmail: campaignEmailText } : {}),
      },
    });

    // 5. Update company status
    await prisma.company.update({
      where: { id: companyId },
      data: { crawlStatus: 'COMPLETED', lastCrawledAt: new Date(), name: upsertName },
    });

    console.log(`[worker] done ${domain} — score: ${upsertScore}`);
    await updateBatchProgress(batchId);

    // 6. Enqueue personalization — best-effort; failure must not cause a crawl retry or FAILED status
    try {
      const pQueue = await getQueue();
      await enqueuePersonalizeJob({ companyId }, pQueue);
    } catch (personErr) {
      console.error(`[worker] personalize enqueue failed for ${domain}:`, personErr);
    }
  } catch (err) {
    console.error(`[worker] failed ${domain}:`, err);

    const retryLimit = 3;
    const isFinalAttempt = (job.retryCount ?? 0) >= retryLimit - 1;

    if (isFinalAttempt) {
      // On the final attempt, mark COMPLETED if a useful profile was already saved —
      // e.g. the crawl succeeded but a downstream step (personalization enqueue,
      // batch progress) failed on every retry attempt.
      const saved = await prisma.companyProfile.findUnique({
        where: { companyId },
        select: { emails: true, phones: true, completionScore: true, loginProtected: true, companyNameFromLogo: true },
      }).catch(() => null);
      const hasUsefulData = saved && (
        (Array.isArray(saved.emails) && (saved.emails as string[]).length > 0) ||
        (Array.isArray(saved.phones) && (saved.phones as string[]).length > 0) ||
        (saved.completionScore >= 50) ||
        // Login-protected site where we successfully recovered identity from the logo
        (saved.loginProtected && !!saved.companyNameFromLogo)
      );
      const finalStatus = hasUsefulData ? 'COMPLETED' : 'FAILED';
      console.log(`[worker] final attempt ${domain} — profile hasUsefulData=${hasUsefulData} → ${finalStatus}`);
      // Guard prevents downgrading a parallel COMPLETED result
      await prisma.company.updateMany({
        where: { id: companyId, crawlStatus: { not: 'COMPLETED' } },
        data: {
          crawlStatus: finalStatus,
          ...(hasUsefulData ? { lastCrawledAt: new Date() } : {}),
        },
      });
      await updateBatchProgress(batchId);
    } else {
      await prisma.company.updateMany({
        where: { id: companyId, crawlStatus: { not: 'COMPLETED' } },
        data: { crawlStatus: 'PENDING' },
      });
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
