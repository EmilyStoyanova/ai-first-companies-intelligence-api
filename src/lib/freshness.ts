// Configurable score threshold. Profiles below this are considered incomplete
// and will be re-crawled even if lastCrawledAt is within 30 days.
export const COMPLETION_SCORE_THRESHOLD = 50;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface FreshnessProfile {
  completionScore: number;
  emails: unknown;
  phones: unknown;
  name?: string | null;
  description?: string | null;
}

export interface FreshnessCompany {
  lastCrawledAt: Date | null;
  crawlStatus: string;
  profile: FreshnessProfile | null;
}

export interface FreshnessResult {
  skip: boolean;
  reason: string;
}

/**
 * Decide whether a company can reuse its existing crawl data or must be re-crawled.
 *
 * Skip (reuse) only when ALL of the following hold:
 *   1. forceRecrawl is false
 *   2. crawlStatus is not FAILED / BLOCKED / PENDING
 *   3. lastCrawledAt is within 30 days
 *   4. A CompanyProfile exists
 *   5. completionScore >= COMPLETION_SCORE_THRESHOLD
 *   6. Profile has at least one email OR phone
 *   7. Profile has a name OR description
 */
export function checkFreshness(
  company: FreshnessCompany,
  forceRecrawl: boolean,
): FreshnessResult {
  if (forceRecrawl) {
    return { skip: false, reason: 'force_recrawl=true' };
  }

  if (
    company.crawlStatus === 'FAILED' ||
    company.crawlStatus === 'BLOCKED' ||
    company.crawlStatus === 'PENDING'
  ) {
    return { skip: false, reason: `previous crawlStatus=${company.crawlStatus}` };
  }

  if (!company.lastCrawledAt) {
    return { skip: false, reason: 'never successfully crawled' };
  }

  const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);
  if (company.lastCrawledAt <= thirtyDaysAgo) {
    return { skip: false, reason: 'stale — last crawled >30 days ago' };
  }

  if (!company.profile) {
    return { skip: false, reason: 'no profile stored' };
  }

  const { profile } = company;

  if (profile.completionScore < COMPLETION_SCORE_THRESHOLD) {
    return {
      skip: false,
      reason: `profile incomplete — score=${profile.completionScore} below threshold ${COMPLETION_SCORE_THRESHOLD}`,
    };
  }

  const emails = Array.isArray(profile.emails) ? profile.emails : [];
  const phones = Array.isArray(profile.phones) ? profile.phones : [];
  if (emails.length === 0 && phones.length === 0) {
    return { skip: false, reason: 'profile incomplete — no emails and no phones' };
  }

  if (!profile.name && !profile.description) {
    return { skip: false, reason: 'profile incomplete — no name and no description' };
  }

  return {
    skip: true,
    reason: `fresh good profile (score=${profile.completionScore}, crawled=${company.lastCrawledAt.toISOString()})`,
  };
}
