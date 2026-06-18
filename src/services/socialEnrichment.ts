import { normalizeSocialUrl } from './extraction';
import type { ExtractedProfile } from './extraction';
import { cachedSearch } from '../lib/search';
import type { SearchResult } from '../lib/search';

// Enrich missing company social links using the configured search provider.
// Only searches for platforms absent from the crawled HTML.
// Returns a partial socialLinks record; the caller merges with the existing one.
// All errors are caught internally — this must never break the crawl pipeline.
export async function enrichSocialLinks(
  profile: ExtractedProfile,
  domain: string,
): Promise<Record<string, string>> {
  const missing = (['facebook', 'linkedin'] as const).filter(
    (k) => !profile.socialLinks[k],
  );
  if (missing.length === 0) return {};

  const searchIdentifier = profile.name ?? domain.split('.')[0];
  if (!searchIdentifier || searchIdentifier.length < 2) return {};

  const enriched: Record<string, string> = {};

  for (const platform of missing) {
    try {
      const platformLabel = platform === 'linkedin' ? 'LinkedIn company' : 'Facebook';
      const query = `"${searchIdentifier}" ${platformLabel}`;
      const results = await cachedSearch(query);

      for (const result of results.slice(0, 5)) {
        const normalized = normalizeSocialUrl(result.url);
        if (!normalized || normalized.platform !== platform) continue;
        if (isHighConfidence(normalized.url, result.title, result.snippet, profile.name, domain)) {
          enriched[platform] = normalized.url;
          console.log(`[social] found ${platform} for ${domain} via search: ${normalized.url}`);
          break;
        }
      }
    } catch {
      // Non-critical — social enrichment failure must not affect crawl outcome
    }
  }

  return enriched;
}

/**
 * Score how confident we are that `socialUrl` belongs to the company at `domain`.
 *
 * Rubric (signals are independent; require total ≥ 2 to accept):
 *   +2  URL slug exactly equals the normalised domain base (e.g. "yotovstone")
 *   +2  URL slug starts with / is the prefix of the domain base (len ≥ 5)
 *       — catches "crosscyclebikes" for domain "crosscycle"
 *   +1  Full company name (≥ 5 chars) found in title or snippet
 *   +1  A long distinctive word (≥ 7 chars) from the company name found in title/snippet
 *   +2  Source domain explicitly mentioned in snippet (strongest confirmation)
 *
 * "Crosscycle" vs "crossschoolsbluffton": no prefix/exact match (signal 1 = 0),
 * "crosscycle" absent from title (signal 2 = 0) → total 0, correctly rejected.
 * A single short generic word such as "cross" or "tech" matching a title is never
 * sufficient on its own (1 point < 2 threshold).
 */
export function scoreConfidence(
  socialUrl: string,
  title: string | undefined,
  snippet: string | undefined,
  companyName: string | undefined,
  domain: string,
): number {
  // Normalise: strip hyphens/dots/underscores so "cross-cycle" == "crosscycle"
  const domainBase = domain.split('.')[0].toLowerCase().replace(/[-_.]/g, '');
  const socialSlug = (socialUrl.split('/').filter(Boolean).pop() ?? '')
    .toLowerCase()
    .replace(/[-_.]/g, '');
  const combined = ((title ?? '') + ' ' + (snippet ?? '')).toLowerCase();

  let score = 0;

  // ── Signal 1: URL slug ↔ domain base name similarity ────────────────────────
  if (domainBase.length >= 4 && socialSlug.length >= 2) {
    if (socialSlug === domainBase) {
      // Exact match — very strong
      score += 2;
    } else if (
      domainBase.length >= 6 &&
      (socialSlug.startsWith(domainBase) || domainBase.startsWith(socialSlug))
    ) {
      // One is a prefix of the other — strong (catches brand + suffix like "crosscyclebikes").
      // Threshold >= 6 prevents 5-char generic words like "cross" or "stars" triggering this
      // via a coincidental prefix (e.g. "crossschoolsbluffton" starts with "cross").
      score += 2;
    } else if (
      domainBase.length >= 7 &&
      (socialSlug.includes(domainBase) || domainBase.includes(socialSlug))
    ) {
      // Substring — weaker (only accepted for long base names to avoid short-word coincidences)
      score += 1;
    }
  }

  // ── Signal 2: company name in title / snippet ────────────────────────────────
  if (companyName) {
    const nameLower = companyName.toLowerCase().trim();
    if (nameLower.length >= 5 && combined.includes(nameLower)) {
      score += 1;
    } else {
      // Long-word check runs only when the full name did NOT match — avoids double-counting
      // when the company name is itself a single long word (e.g. "Walltopia").
      // Short words (≤ 6 chars) like "cross", "tech", "star" are too common to count.
      const longWords = nameLower.split(/\s+/).filter((w) => w.length >= 7);
      if (longWords.some((w) => combined.includes(w))) score += 1;
    }
  }

  // ── Signal 3: domain URL in snippet — strongest possible confirmation ────────
  if (snippet && snippet.toLowerCase().includes(domain)) {
    score += 2;
  }

  return score;
}

// Returns true when enough independent signals confirm the social page belongs to
// the company.  Threshold: score ≥ 2 (two independent signals required).
export function isHighConfidence(
  socialUrl: string,
  title: string | undefined,
  snippet: string | undefined,
  companyName: string | undefined,
  domain: string,
): boolean {
  return scoreConfidence(socialUrl, title, snippet, companyName, domain) >= 2;
}

