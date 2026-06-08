import { normalizeSocialUrl } from './extraction';
import type { ExtractedProfile } from './extraction';

interface SearchResult {
  url: string;
  title?: string;
}

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
      const results = await rawSearch(query);

      for (const result of results.slice(0, 5)) {
        const normalized = normalizeSocialUrl(result.url);
        if (!normalized || normalized.platform !== platform) continue;
        if (isHighConfidence(normalized.url, result.title, profile.name, domain)) {
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

// Return true when the search result is very likely the company's own social page
// rather than a mention, competitor, or unrelated entity.
function isHighConfidence(
  socialUrl: string,
  title: string | undefined,
  companyName: string | undefined,
  domain: string,
): boolean {
  const domainBase = domain.split('.')[0].toLowerCase();
  const socialSlug = socialUrl.split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
  const titleLower = (title ?? '').toLowerCase();

  // URL slug shares content with the domain base
  if (socialSlug.includes(domainBase) || (domainBase.length > 3 && domainBase.includes(socialSlug))) return true;

  if (companyName && companyName.length > 3) {
    const nameLower = companyName.toLowerCase();
    // Title directly contains the company name
    if (titleLower.includes(nameLower)) return true;
    // Any word > 4 chars from the company name appears in the title
    const words = nameLower.split(/\s+/).filter((w) => w.length > 4);
    if (words.length > 0 && words.some((w) => titleLower.includes(w))) return true;
  }

  return false;
}

async function rawSearch(query: string): Promise<SearchResult[]> {
  const provider = process.env.SEARCH_PROVIDER?.toLowerCase() === 'serper' ? 'serper' : 'brave';

  if (provider === 'serper') {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return [];
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({ q: query, num: 5 }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      organic?: Array<{ link: string; title?: string }>;
    };
    return (data.organic ?? []).map((r) => ({ url: r.link, title: r.title }));
  }

  // Default: Brave Search
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const data = await res.json() as {
    web?: { results?: Array<{ url: string; title?: string }> };
  };
  return (data.web?.results ?? []).map((r) => ({ url: r.url, title: r.title }));
}
