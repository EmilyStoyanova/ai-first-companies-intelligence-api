export interface DiscoveryParams {
  persona: string;
  location: string;
  keywords?: string;
  maxResults?: number;
}

export interface DiscoveredSite {
  url: string;
  domain: string;
  title?: string;
  snippet?: string;
}

function buildQuery(params: DiscoveryParams): string {
  const parts = [params.persona.trim(), params.location.trim()];
  if (params.keywords?.trim()) parts.push(params.keywords.trim());
  // Bias results toward real org websites rather than directories
  parts.push('официален сайт');
  return parts.join(' ');
}

function extractDomain(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Domains (and their subdomains) that are not individual org websites
const SKIP_DOMAINS = [
  // Social media
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
  'linkedin.com', 'youtube.com', 'tiktok.com',
  // Search engines & maps
  'google.com', 'bing.com', '2gis.com', '2gis.bg',
  // Encyclopedias
  'wikipedia.org', 'bg.wikipedia.org', 'wikidata.org',
  // Bulgarian business/org directories & aggregators
  'katalog.bg', 'firmeni.bg', 'firma.bg',
  'registryagency.bg', 'brra.bg',
  'industryinfo.bg', 'korektnafirma.com',
  'businessaccountbg.com',
  // Job boards
  'zaplata.bg', 'jobs.bg', 'rabota.bg', 'karieri.bg', 'bgjobs.com',
  // Service & professional marketplaces
  'starofservice.bg', 'starofservice.com',
  'bark.com', 'thumbtack.com',
  // Review & local discovery
  'oink.bg',
  // Health directories & portals
  'framar.bg', 'zdravenportal.com', 'zdravencatalog.com',
  'puls.bg', 'medrec-m.com',
  // Professional chambers & associations (not individual companies)
  'bcpea.org', 'bcci.bg', 'bia-bg.com',
  // Government e-services portals
  'egov.bg', 'e-gov.bg',
  // Municipality & government portals (subdomains like live.varna.bg also matched)
  'obshtini.bg', 'varna.bg', 'sofia.bg', 'plovdiv.bg', 'burgas.bg',
  'ruse.bg', 'stara-zagora.bg', 'pleven.bg', 'sliven.bg', 'dobrich.bg',
  'lovech.bg', 'montana.bg', 'vidin.bg', 'vratsa.bg', 'gabrovo.bg',
  'targovishte.bg', 'razgrad.bg', 'shumen.bg', 'silistra.bg',
  'kardzhali.bg', 'smolyan.bg', 'blagoevgrad.bg', 'kyustendil.bg',
  'pernik.bg', 'sofia-grad.bg', 'government.bg', 'parliament.bg',
  // Category-specific aggregator sites
  'detskigradini.bg', 'detskitegradini.com', 'registarnadetskitegradini.com',
  // Review & travel aggregators
  'tripadvisor.com', 'tripadvisor.bg', 'yelp.com',
];

// Pattern-based rules for domain families that can't be enumerated
const SKIP_PATTERNS: RegExp[] = [
  /^ruo-/,          // Regional education departments: ruo-varna.bg, ruo-sofia.bg …
  /^rio-/,          // Older naming variant of the same offices
  /\.government\.bg$/, // Any government subdomain
];

function shouldSkip(domain: string): boolean {
  if (SKIP_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  if (SKIP_PATTERNS.some((re) => re.test(domain))) return true;
  return false;
}

// ── Brave Search API ──────────────────────────────────────────────────────────
// Sign up at https://api.search.brave.com — free tier: 2,000 queries/month
// Set env var: BRAVE_SEARCH_API_KEY

interface BraveResult {
  url: string;
  title?: string;
  description?: string;
}

async function searchViaBrave(query: string, maxResults: number): Promise<DiscoveredSite[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY!;
  const count = Math.min(maxResults, 20); // Brave free tier: max 20 per request

  const url =
    `https://api.search.brave.com/res/v1/web/search` +
    `?q=${encodeURIComponent(query)}&count=${count}&country=ALL&search_lang=bg`;

  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
  });

  if (!res.ok) {
    throw new Error(`Brave Search API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { web?: { results?: BraveResult[] } };
  const results: DiscoveredSite[] = [];

  for (const item of data.web?.results ?? []) {
    const domain = extractDomain(item.url);
    if (!domain || shouldSkip(domain)) continue;
    results.push({ url: item.url, domain, title: item.title, snippet: item.description });
  }

  return results;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function discoverSites(params: DiscoveryParams): Promise<DiscoveredSite[]> {
  const maxResults = Math.min(params.maxResults ?? 20, 50);
  const query = buildQuery(params);

  console.log(`[discovery] query="${query}" max=${maxResults}`);

  if (!process.env.BRAVE_SEARCH_API_KEY) {
    throw new Error('BRAVE_SEARCH_API_KEY is not set.');
  }

  return searchViaBrave(query, maxResults);
}
