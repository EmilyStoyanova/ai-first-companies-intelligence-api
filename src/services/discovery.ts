export interface DiscoveryParams {
  persona: string;
  location: string;
  keywords?: string;
  maxResults?: number;
}

export type CandidateStatus = 'kept' | 'filtered' | 'blocked';

export type RejectionReason =
  | 'MUNICIPALITY'
  | 'DIRECTORY'
  | 'NEWS_SITE'
  | 'EDUCATION_PORTAL'
  | 'AGGREGATOR'
  | 'LOCATION_MISMATCH'
  | 'NOT_TARGET_ORGANIZATION';

export interface DiscoveredSite {
  url: string;
  domain: string;
  title?: string;
  snippet?: string;
  status: CandidateStatus;
  rejectionReason?: RejectionReason;
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
  'lovech.bg', 'montana.bg', 'vidin.bg', 'vratsa.bg', 'vratza.bg', 'gabrovo.bg',
  'targovishte.bg', 'razgrad.bg', 'shumen.bg', 'silistra.bg',
  'kardzhali.bg', 'smolyan.bg', 'blagoevgrad.bg', 'kyustendil.bg',
  'pernik.bg', 'sofia-grad.bg', 'government.bg', 'parliament.bg',
  // Additional municipality domains with alternate spellings / obshtina- prefix
  'obshtina.bg', 'pazardzhik.bg', 'lovech-obshtina.bg',
  'yambol.bg', 'haskovo.bg', 'sandanski.bg', 'blagoevgrad-ob.bg',
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
  /^ruo-/,              // Regional education departments: ruo-varna.bg, ruo-sofia.bg …
  /^rio-/,              // Older naming variant of the same offices
  /\.government\.bg$/,  // Any government subdomain
  /^obshtina-/,         // Municipality domains: obshtina-sofia.bg, obshtina-varna.bg …
];

function shouldSkip(domain: string): boolean {
  if (SKIP_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  if (SKIP_PATTERNS.some((re) => re.test(domain))) return true;
  return false;
}

// ── Search provider error ─────────────────────────────────────────────────────
// Thrown when Brave returns a billing/quota/auth status that means no results
// can be trusted. Distinct from an empty-results response (which is valid data).

export class SearchProviderError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly query: string,
    public readonly provider: string = 'unknown',
  ) {
    super(`${provider} returned HTTP ${statusCode} for query "${query}"`);
    this.name = 'SearchProviderError';
  }
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

// Status codes that indicate a billing, quota, auth, or rate-limit problem.
// On these codes we throw SearchProviderError instead of silently returning [].
// Returning [] would mislead the caller into thinking there are no matching sites.
const PROVIDER_HARD_ERROR_CODES = new Set([401, 402, 403, 429]);

async function fetchBraveQuery(apiKey: string, query: string): Promise<DiscoveredSite[]> {
  const url =
    `https://api.search.brave.com/res/v1/web/search` +
    `?q=${encodeURIComponent(query)}&count=${BRAVE_COUNT}&country=ALL&search_lang=bg`;

  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
  });

  if (!res.ok) {
    let bodySnippet = '(empty)';
    try { bodySnippet = (await res.text()).slice(0, 300); } catch { /* ignore */ }

    if (PROVIDER_HARD_ERROR_CODES.has(res.status)) {
      console.error(`[discovery] Brave hard error HTTP ${res.status} query="${query}" body=${bodySnippet}`);
      throw new SearchProviderError(res.status, query, 'Brave Search');
    }
    console.warn(`[discovery] Brave soft error HTTP ${res.status} query="${query}" body=${bodySnippet}`);
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

// ── Serper.dev API ────────────────────────────────────────────────────────────
// Alternative to Brave Search. Sign up at https://serper.dev
// Free tier: 2,500 queries. Set env vars: SEARCH_PROVIDER=serper SERPER_API_KEY=...

interface SerperResult {
  title?: string;
  link: string;
  snippet?: string;
}

async function fetchSerperQuery(apiKey: string, query: string): Promise<DiscoveredSite[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({ q: query, gl: 'bg', hl: 'bg', num: BRAVE_COUNT }),
  });

  if (!res.ok) {
    let bodySnippet = '(empty)';
    try { bodySnippet = (await res.text()).slice(0, 300); } catch { /* ignore */ }

    if (PROVIDER_HARD_ERROR_CODES.has(res.status)) {
      console.error(`[discovery] Serper hard error HTTP ${res.status} query="${query}" body=${bodySnippet}`);
      throw new SearchProviderError(res.status, query, 'Serper');
    }
    console.warn(`[discovery] Serper soft error HTTP ${res.status} query="${query}" body=${bodySnippet}`);
    return [];
  }

  const data = await res.json() as { organic?: SerperResult[] };
  const results: DiscoveredSite[] = [];

  for (const item of data.organic ?? []) {
    const domain = extractDomain(item.link);
    if (!domain) continue;
    results.push({
      url: item.link,
      domain,
      title: item.title,
      snippet: item.snippet,
      status: shouldSkip(domain) ? 'blocked' : 'kept',
    });
  }

  return results;
}

// ── Provider dispatch ─────────────────────────────────────────────────────────

function activeProvider(): 'brave' | 'serper' {
  const v = (
    process.env.SEARCH_PRIMARY_PROVIDER ??
    process.env.SEARCH_PROVIDER ??
    'brave'
  ).toLowerCase();
  return v === 'serper' ? 'serper' : 'brave';
}

async function fetchQuery(query: string): Promise<DiscoveredSite[]> {
  const provider = activeProvider();
  if (provider === 'serper') {
    return fetchSerperQuery(process.env.SERPER_API_KEY!, query);
  }
  return fetchBraveQuery(process.env.BRAVE_SEARCH_API_KEY!, query);
}

// Major towns per Bulgarian oblast, ordered by population.
// Used to generate per-town search queries when the location is an oblast.
const OBLAST_TOWNS: Record<string, string[]> = {
  'ловеч':          ['Ловеч', 'Троян', 'Луковит', 'Тетевен'],
  'пловдив':        ['Пловдив', 'Асеновград', 'Карлово', 'Раковски'],
  'варна':          ['Варна', 'Провадия', 'Девня', 'Долни Чифлик'],
  'бургас':         ['Бургас', 'Несебър', 'Поморие', 'Айтос'],
  'софия':          ['София', 'Ботевград', 'Самоков', 'Ихтиман'],
  'стара загора':   ['Стара Загора', 'Казанлък', 'Чирпан', 'Гълъбово'],
  'велико търново': ['Велико Търново', 'Горна Оряховица', 'Свищов', 'Лясковец'],
  'русе':           ['Русе', 'Бяла', 'Ветово', 'Борово'],
  'плевен':         ['Плевен', 'Кнежа', 'Никопол', 'Долни Дъбник'],
  'габрово':        ['Габрово', 'Севлиево', 'Дряново', 'Трявна'],
  'видин':          ['Видин', 'Белоградчик', 'Брегово'],
  'враца':          ['Враца', 'Козлодуй', 'Мездра', 'Бяла Слатина'],
  'монтана':        ['Монтана', 'Берковица', 'Лом', 'Вършец'],
  'добрич':         ['Добрич', 'Балчик', 'Каварна', 'Тервел'],
  'шумен':          ['Шумен', 'Нови пазар', 'Велики Преслав', 'Каспичан'],
  'хасково':        ['Хасково', 'Димитровград', 'Свиленград', 'Харманли'],
  'кърджали':       ['Кърджали', 'Момчилград', 'Крумовград', 'Джебел'],
  'смолян':         ['Смолян', 'Девин', 'Рудозем', 'Чепеларе'],
  'благоевград':    ['Благоевград', 'Сандански', 'Разлог', 'Банско'],
  'кюстендил':      ['Кюстендил', 'Дупница', 'Бобошево'],
  'перник':         ['Перник', 'Радомир', 'Брезник'],
  'разград':        ['Разград', 'Исперих', 'Кубрат', 'Лозница'],
  'силистра':       ['Силистра', 'Тутракан', 'Дулово', 'Алфатар'],
  'търговище':      ['Търговище', 'Попово', 'Омуртаг', 'Антоново'],
  'сливен':         ['Сливен', 'Нова Загора', 'Котел', 'Твърдица'],
  'ямбол':          ['Ямбол', 'Елхово', 'Стралджа'],
  'пазарджик':      ['Пазарджик', 'Велинград', 'Панагюрище', 'Ракитово'],
};

// Extract major towns for a location string that looks like "област Ловеч" or "Ловеч".
// Returns an empty array for city-level locations (no expansion needed).
function getOblastTowns(location: string): string[] {
  // Match "област X" or "oblast X" (case-insensitive)
  const oblastMatch = location.match(/^(?:област|oblast)\s+(.+)$/i);
  const key = (oblastMatch ? oblastMatch[1] : location).toLowerCase().trim();
  return OBLAST_TOWNS[key] ?? [];
}

function buildQueryVariations(params: DiscoveryParams): string[] {
  const persona = params.persona.trim();
  const location = params.location.trim();
  const extra = params.keywords?.trim() ? ` ${params.keywords.trim()}` : '';

  const queries: string[] = [
    `${persona} ${location}${extra} официален сайт`,
    `${persona} ${location}${extra} контакти телефон имейл`,
    `site:.bg ${persona} ${location}${extra}`,
    `${persona} ${location}${extra} услуги`,
  ];

  // For oblast locations, append per-town queries for top 3 towns.
  // Each town query targets the specific municipality, complementing the oblast-level queries.
  const towns = getOblastTowns(location).slice(0, 3);
  for (const town of towns) {
    queries.push(`${persona} ${town}${extra} контакти`);
  }

  return queries;
}

async function searchViaProvider(params: DiscoveryParams): Promise<DiscoveredSite[]> {
  const variations = buildQueryVariations(params);
  const pages = await Promise.all(variations.map((q) => fetchQuery(q)));

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

// ── Groq response types ───────────────────────────────────────────────────────

interface GroqRejection {
  i: number;
  c: RejectionReason;
}

interface GroqFilterResponse {
  k: number[];
  r: GroqRejection[];
}

// ── Groq relevance filter ─────────────────────────────────────────────────────
// Sends only 'kept' candidates to Groq. Non-selected ones get status 'filtered'.
// 'blocked' candidates are never sent to Groq — their status stays 'blocked'.
// Gracefully degrades when GROQ_API_KEY is not set (all 'kept' stay 'kept').

async function groqRelevanceFilter(
  sites: DiscoveredSite[],
  params: DiscoveryParams,
): Promise<DiscoveredSite[]> {
  const candidates = sites.filter((s) => s.status === 'kept');
  if (candidates.length === 0) return sites;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[discovery] GROQ_API_KEY not set — skipping LLM filter');
    return sites;
  }

  const items = candidates
    .map((s, i) => `${i}: ${s.title ?? s.domain} — ${s.snippet ?? '(no snippet)'}`)
    .join('\n');

  const prompt =
    `You are a B2B lead qualification engine for the Bulgarian market.

TASK: For each result, determine if the website is owned/operated BY an organization that IS ITSELF a "${params.persona}" in or near "${params.location}".

CRITICAL DISTINCTION — the key question is ownership/identity, not topic:
- Website that MENTIONS or LISTS "${params.persona}" → REJECT
- Website that IS OPERATED BY a "${params.persona}" → KEEP

Ask yourself: "Would this organization describe itself as '${params.persona}'?"
If YES → KEEP.  If NO (they manage/list/discuss/oversee them) → REJECT.

KEEP if:
1. The organization itself IS a ${params.persona}
2. It's in or near "${params.location}"
3. It appears to be the official site of exactly one organization

REJECT with reason:
- MUNICIPALITY: City hall, obshtina, regional government portal (even if it has a "${params.persona}" section)
- DIRECTORY: Lists or aggregates multiple organizations of this type
- NEWS_SITE: News article, blog, press release, announcement
- EDUCATION_PORTAL: Government education authority (RUO, RIO, MОН) — not the school/kindergarten itself
- AGGREGATOR: Ratings, reviews, comparisons, top-N lists
- LOCATION_MISMATCH: Clearly in a different city/region
- NOT_TARGET_ORGANIZATION: Wrong category of organization entirely

ILLUSTRATIVE EXAMPLES (for "детски градини" in "гр. Враца"):

KEEP — these ARE kindergartens:
  "ДГ Звънче – Официален сайт, гр. Враца" → ДГ prefix = детска градина ✓
  "Детска градина Пролет Враца – Записване и контакти" → explicitly a kindergarten ✓

REJECT — these are NOT kindergartens:
  "Община Враца – раздел Детски градини" → MUNICIPALITY (municipal portal, not a kindergarten)
  "vratza.bg – Официален сайт на Община Враца" → MUNICIPALITY
  "Детски градини Враца | Пълен списък и рейтинг" → DIRECTORY
  "ruo-vratsa.bg – РИО Враца" → EDUCATION_PORTAL
  "Новини: Нова детска градина ще отвори врати" → NEWS_SITE

Results to classify (index: title — snippet):
${items}

Output: ONLY valid JSON in this exact format, no other text:
{"k":[kept_indices],"r":[{"i":rejected_index,"c":"REASON_CODE"},...]}`
;

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
        max_tokens: 400,
      }),
    });

    if (!res.ok) {
      console.warn(`[discovery] Groq API error ${res.status} — skipping LLM filter`);
      return sites;
    }

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const raw = data.choices[0]?.message?.content?.trim() ?? '';

    // Try new structured format first: {"k":[...],"r":[...]}
    const objectMatch = raw.match(/\{[\s\S]*"k"\s*:\s*\[[\s\S]*?\][\s\S]*\}/);
    // Fall back to legacy format: [0,2,4]
    const arrayMatch = raw.match(/\[[\d,\s]*\]/);

    let keptIndices: Set<number>;
    const rejectionMap = new Map<number, RejectionReason>();

    if (objectMatch) {
      const parsed = JSON.parse(objectMatch[0]) as GroqFilterResponse;
      keptIndices = new Set(
        (parsed.k ?? []).filter((i): i is number => typeof i === 'number' && i >= 0 && i < candidates.length),
      );
      for (const entry of parsed.r ?? []) {
        if (typeof entry.i === 'number' && typeof entry.c === 'string') {
          rejectionMap.set(entry.i, entry.c as RejectionReason);
        }
      }
    } else if (arrayMatch) {
      const indices = JSON.parse(arrayMatch[0]) as unknown[];
      keptIndices = new Set(
        indices.filter((i): i is number => typeof i === 'number' && i >= 0 && i < candidates.length),
      );
    } else {
      throw new Error(`unparseable Groq response: ${raw.slice(0, 120)}`);
    }

    // Rebuild full list: blocked stays blocked, kept→filtered if Groq rejected
    let candidateIdx = 0;
    const result = sites.map((site) => {
      if (site.status !== 'kept') return site;
      const idx = candidateIdx++;
      if (keptIndices.has(idx)) return site;
      const reason = rejectionMap.get(idx);
      if (reason) {
        console.log(
          `[discovery] filtered ${site.domain} — ${reason}` +
          (site.title ? ` (${site.title.slice(0, 60)})` : ''),
        );
      }
      return { ...site, status: 'filtered' as const, rejectionReason: reason };
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
  const provider = activeProvider();

  if (provider === 'serper') {
    if (!process.env.SERPER_API_KEY) throw new Error('SERPER_API_KEY is not set (SEARCH_PROVIDER=serper).');
  } else {
    if (!process.env.BRAVE_SEARCH_API_KEY) throw new Error('BRAVE_SEARCH_API_KEY is not set.');
  }

  console.log(`[discovery] provider=${provider} queries=${JSON.stringify(buildQueryVariations(params))}`);

  const raw = await searchViaProvider(params);
  return groqRelevanceFilter(raw, params);
}
