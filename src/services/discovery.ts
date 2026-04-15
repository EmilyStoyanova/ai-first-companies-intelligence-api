export interface DiscoveryParams {
  persona: string;
  location: string;
  keywords?: string;
  maxResults?: number;
}

export type CandidateStatus = 'kept' | 'filtered' | 'blocked';

export interface DiscoveredSite {
  url: string;
  domain: string;
  title?: string;
  snippet?: string;
  status: CandidateStatus;
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
  'vsichkifirmi.com', 'papagal.bg',
  'varna.biz', 'sofia.biz', 'plovdiv.biz', 'burgas.biz',
  // Classified ads portals
  'bezplatno.net', 'olx.bg', 'bazar.bg', 'pazaruvaj.com',
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
  // Restaurant & venue directories
  'zavedenia.com', 'menuonline.bg', 'restogo.bg',
  'restaurant.bg', 'alakart.bg',
  // Hotel & accommodation booking portals
  'rezervaciq.com', 'booking.com', 'airbnb.com',
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

const BRAVE_COUNT = 20; // Brave max results per request

async function fetchBraveQuery(apiKey: string, query: string): Promise<DiscoveredSite[]> {
  const url =
    `https://api.search.brave.com/res/v1/web/search` +
    `?q=${encodeURIComponent(query)}&count=${BRAVE_COUNT}&country=ALL&search_lang=bg`;

  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
  });

  if (!res.ok) {
    console.warn(`[discovery] Brave error for query "${query}": ${res.status}`);
    return [];
  }

  const data = await res.json() as { web?: { results?: BraveResult[] } };
  const results: DiscoveredSite[] = [];

  for (const item of data.web?.results ?? []) {
    const domain = extractDomain(item.url);
    if (!domain) continue;
    results.push({
      url: item.url,
      domain,
      title: item.title,
      snippet: item.description,
      status: shouldSkip(domain) ? 'blocked' : 'kept',
    });
  }

  return results;
}

function buildQueryVariations(params: DiscoveryParams): string[] {
  const base = [params.persona.trim(), params.location.trim()];
  if (params.keywords?.trim()) base.push(params.keywords.trim());

  return [
    [...base, 'официален сайт'].join(' '),
    [...base, 'контакти'].join(' '),
    [...base, 'услуги'].join(' '),
  ];
}

async function searchViaBrave(params: DiscoveryParams): Promise<DiscoveredSite[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY!;
  const variations = buildQueryVariations(params);

  const pages = await Promise.all(variations.map((q) => fetchBraveQuery(apiKey, q)));

  // Merge, deduplicate by domain — keep ALL (blocked + kept)
  const seen = new Set<string>();
  const results: DiscoveredSite[] = [];

  for (const page of pages) {
    for (const site of page) {
      if (seen.has(site.domain)) continue;
      seen.add(site.domain);
      results.push(site);
    }
  }

  return results;
}

// ── Groq relevance filter ─────────────────────────────────────────────────────
// Sends only 'kept' candidates to Groq. Non-selected ones get status 'filtered'.
// 'blocked' candidates are never sent to Groq — their status stays 'blocked'.
// Gracefully degrades when GROQ_API_KEY is not set (all 'kept' stay 'kept').

async function groqRelevanceFilter(
  sites: DiscoveredSite[],
  params: DiscoveryParams,
): Promise<DiscoveredSite[]> {
  // Only send non-blocked candidates to Groq
  const candidates = sites.filter((s) => s.status === 'kept');
  if (candidates.length === 0) return sites;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[discovery] GROQ_API_KEY not set — skipping LLM filter');
    return sites;
  }

  const items = candidates
    .map((s, i) => `${i}: ${s.title ?? s.domain} — ${s.snippet ?? ''}`)
    .join('\n');

  const searchContext = [
    `"${params.persona}"`,
    `in "${params.location}"`,
    params.keywords ? `(keywords: ${params.keywords})` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const prompt =
    `You are filtering web search results.

    Goal:
    Return ONLY results that are the official website of a SINGLE real-world company or organisation that matches the search intent.

    Search intent:
    "${searchContext}"

    Results (index: title — snippet):
    ${items}

    Definition of "official website":
    - The primary website owned/controlled by that company or organisation
    - Represents exactly ONE entity (not multiple)
    - Typically contains: services/products, contact info, about page, branding

    STRICT KEEP rules:
    - Must clearly represent ONE specific company or organisation
    - Must match the search intent (e.g. IT company in Varna, kindergarten in Lovech)
    - Local business websites are valid

    STRICT DISCARD rules:
    - Directories, aggregators, listings (e.g. "top companies", "catalog", "firms in X")
    - Marketplace / classifieds
    - Job boards
    - Review sites (e.g. ratings, comparisons)
    - Maps (Google Maps, etc.)
    - Social media pages (Facebook, LinkedIn, Instagram)
    - Government / municipality portals
    - Wikipedia or informational sites
    - Pages listing MULTIPLE businesses
    - Generic landing pages not tied to a specific company

    Edge cases:
    - If unsure → DISCARD
    - If multiple companies are mentioned → DISCARD
    - If it's a subpage of a directory → DISCARD

    Examples:

    Search: "IT companies Varna"

    KEEP:
    - "XYZ Software Ltd – Custom Software Development"
    - "ABC Tech Varna – IT Services"

    DISCARD:
    - "Top 10 IT Companies in Varna"
    - "varnafirms.bg"
    - "Yellow Pages Varna"
    - "LinkedIn company listings"

    Output format:
    Return ONLY a JSON array of indices (e.g. [0,2,4])
    No explanation. No text.`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 150,
      }),
    });

    if (!res.ok) {
      console.warn(`[discovery] Groq API error ${res.status} — skipping LLM filter`);
      return sites;
    }

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const raw = data.choices[0]?.message?.content?.trim() ?? '';

    // Strip markdown code fences and extract the JSON array — LLMs sometimes wrap output
    const match = raw.match(/\[[\d,\s]*\]/);
    if (!match) throw new Error(`no JSON array in Groq response: ${raw.slice(0, 80)}`);

    const indices: unknown = JSON.parse(match[0]);
    if (!Array.isArray(indices)) throw new Error('not an array');

    const keptIndices = new Set(
      (indices as unknown[]).filter(
        (i): i is number => typeof i === 'number' && i >= 0 && i < candidates.length,
      ),
    );

    // Rebuild full list: blocked stays blocked, kept→filtered if Groq rejected
    let candidateIdx = 0;
    const result = sites.map((site) => {
      if (site.status !== 'kept') return site;
      const idx = candidateIdx++;
      return keptIndices.has(idx) ? site : { ...site, status: 'filtered' as const };
    });

    const keptCount = result.filter((s) => s.status === 'kept').length;
    console.log(`[discovery] Groq filter: ${candidates.length} candidates → ${keptCount} kept`);
    return result;
  } catch (err) {
    console.warn('[discovery] Groq filter failed — returning unfiltered results:', err);
    return sites;
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────
// Returns ALL candidates (kept + filtered + blocked) so the worker can persist
// them and the UI can show the full picture.

export async function discoverSites(params: DiscoveryParams): Promise<DiscoveredSite[]> {
  if (!process.env.BRAVE_SEARCH_API_KEY) {
    throw new Error('BRAVE_SEARCH_API_KEY is not set.');
  }

  console.log(`[discovery] queries=${JSON.stringify(buildQueryVariations(params))}`);

  const raw = await searchViaBrave(params);
  return groqRelevanceFilter(raw, params);
}
