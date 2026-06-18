export enum Crawlability {
  CRAWLABLE = 'CRAWLABLE',
  SOCIAL_PROFILE = 'SOCIAL_PROFILE',
  NON_CRAWLABLE_PLATFORM = 'NON_CRAWLABLE_PLATFORM',
  BLOCKED = 'BLOCKED',
  UNKNOWN = 'UNKNOWN',
}

export const NON_CRAWLABLE_PLATFORM_NOTE = 'NON_CRAWLABLE_PLATFORM';

// Canonical base domains of platforms that must never be crawled as company websites.
// Subdomains (maps.google.com, en.wikipedia.org, bg.linkedin.com) are caught via
// the subdomain-suffix check in isNonCrawlablePlatform().
const NON_CRAWLABLE_DOMAINS = new Set([
  // Social media
  'facebook.com',
  'fb.com',
  'linkedin.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'threads.net',
  'pinterest.com',
  'snapchat.com',
  // Messaging & chat
  'telegram.me',
  't.me',
  'wa.me',
  'whatsapp.com',
  // Reference / encyclopaedia
  'wikipedia.org',
  'wikidata.org',
  // Google properties
  'google.com',
  'goo.gl',
]);

// Generic subdomains that carry no platform identity (stripped iteratively before matching).
const STRIP_SUBDOMAIN_RE = /^(?:www|m|l|lm|web|mobile|business)\./;

function extractHostname(urlOrDomain: string): string {
  let hostname: string;
  try {
    const normalized = urlOrDomain.startsWith('http') ? urlOrDomain : `https://${urlOrDomain}`;
    hostname = new URL(normalized).hostname.toLowerCase();
  } catch {
    hostname = urlOrDomain.toLowerCase().trim();
  }

  // Strip generic subdomains iteratively: www.m.facebook.com → m.facebook.com → facebook.com
  let stripped = hostname;
  while (STRIP_SUBDOMAIN_RE.test(stripped)) {
    stripped = stripped.replace(STRIP_SUBDOMAIN_RE, '');
  }
  return stripped;
}

/**
 * Returns true if the given URL or bare domain belongs to a platform that must
 * never be treated as a crawl target (social networks, messaging apps, reference
 * sites, Google properties, etc.).
 *
 * Handles:
 *   - Bare domains:            facebook.com, linkedin.com
 *   - www/m subdomains:        www.facebook.com, m.facebook.com
 *   - Country/functional subs: bg.linkedin.com, maps.google.com, en.wikipedia.org
 *   - Full URLs:               https://www.linkedin.com/company/openai
 */
export function isNonCrawlablePlatform(urlOrDomain: string): boolean {
  if (!urlOrDomain) return false;

  const hostname = extractHostname(urlOrDomain);

  // Direct match (e.g. facebook.com, youtu.be)
  if (NON_CRAWLABLE_DOMAINS.has(hostname)) return true;

  // Subdomain-of-platform match: maps.google.com → parent = google.com (in set)
  // Only one level of parent is checked — prevents false positives from deep paths.
  const dotIdx = hostname.indexOf('.');
  if (dotIdx > 0) {
    const parent = hostname.slice(dotIdx + 1);
    if (NON_CRAWLABLE_DOMAINS.has(parent)) return true;
  }

  return false;
}

/**
 * Returns the crawlability classification for a URL or domain.
 * Distinguishes between the platform root itself (NON_CRAWLABLE_PLATFORM) and
 * a profile/page hosted on it (SOCIAL_PROFILE), both of which must not be crawled.
 *
 * Examples:
 *   facebook.com                 → NON_CRAWLABLE_PLATFORM
 *   facebook.com/acme            → SOCIAL_PROFILE
 *   linkedin.com/company/openai  → SOCIAL_PROFILE
 *   company.com                  → CRAWLABLE
 */
export function getCrawlability(urlOrDomain: string): Crawlability {
  if (!urlOrDomain) return Crawlability.UNKNOWN;

  if (!isNonCrawlablePlatform(urlOrDomain)) return Crawlability.CRAWLABLE;

  // Has a non-trivial path → profile or page URL on the platform
  try {
    const normalized = urlOrDomain.startsWith('http') ? urlOrDomain : `https://${urlOrDomain}`;
    const path = new URL(normalized).pathname.replace(/^\//, '').replace(/\/$/, '');
    if (path.length > 0) return Crawlability.SOCIAL_PROFILE;
  } catch { /* bare domain */ }

  return Crawlability.NON_CRAWLABLE_PLATFORM;
}

// In-process counters for operational visibility.
export const platformMetrics = {
  nonCrawlableRejected: 0,
  socialProfilesDetected: 0,
  crawlJobsSkipped: 0,

  reset(): void {
    this.nonCrawlableRejected = 0;
    this.socialProfilesDetected = 0;
    this.crawlJobsSkipped = 0;
  },

  summary(): string {
    return (
      `[metrics] skipped ${this.nonCrawlableRejected} non-crawlable platforms, ` +
      `${this.socialProfilesDetected} social profiles detected, ` +
      `${this.crawlJobsSkipped} crawl jobs skipped`
    );
  },
};
