import type { SearchResult } from '../lib/search';
import { rawSearch } from '../lib/search';
import type { ExtractedProfile } from './extraction';
import { looksLikeTimeline, cleanAddressArtifacts } from './extraction';

export interface AddressEnrichmentResult {
  location?: string;
  source: 'website' | 'search' | 'none';
  confidence: number;
  note?: string;
  searchCandidates: string[];
}

interface AddressCandidate {
  text: string;
  score: number;
}

// Detects street-level address content: named street indicators or explicit labels.
// The ["'«»''""] class covers ASCII straight quotes and Unicode curly quotes so
// that addresses like str. "Ilinden" or str. 'Ilinden' score correctly.
const STREET_SIGNAL_RE =
  /(?:ул|бул|пл|кв|ж\.к|жк)\.\s*["'«»''""]?\S|(?:ul|str|bul|blvd?)\.\s*["'«»''""]?\w|\b(?:street|avenue|boulevard|road|drive|lane|plaza)\b|(?:адрес|address|headquarters?)\s*:|офис\s+\d|office\s+\d|,\s*No\.\s*\d/iu;

// Postal code: Bulgarian 4-digit (1000–9999), Western EU 5-digit.
// Not anchored — match anywhere in the text.
const POSTAL_CODE_RE = /(?<![0-9])(?:[1-9]\d{3}|\d{5})(?![0-9])/;

// Words that signal address context in a surrounding search snippet.
const ADDRESS_CONTEXT_RE = /адрес|address|офис|office|contacts?|контакти?|location|headquarter|седалище/i;

/**
 * Score how likely `text` is a valid postal address (0–100).
 * Returns 0 for timelines, CSS content, or text shorter than 5 chars.
 *
 * Scoring:
 *   +40  has a street indicator (ул., бул., street, …)
 *   +20  contains a postal code
 *   +10  text is ≥ 15 chars (eliminates bare city names)
 *   +10  surrounding snippet contains address-context words
 *   +10  company name appears in surrounding snippet context
 *   + 5  domain name appears in surrounding snippet context (weaker signal)
 *
 * Minimum viable threshold to accept a candidate: 40.
 */
export function scoreAddress(
  text: string,
  snippetContext?: string,
  companyName?: string,
  domain?: string,
): number {
  if (!text || text.length < 5) return 0;
  if (looksLikeTimeline(text)) return 0;
  if (/[{}]|!important|:\s*#[0-9a-f]{3,6}|rgba?\(/i.test(text)) return 0;
  // Navigation bullet patterns: "Компания · Колекция · ..." are never addresses.
  if (/\s·\s/.test(text)) return 0;

  let score = 0;

  if (STREET_SIGNAL_RE.test(text)) score += 40;
  if (POSTAL_CODE_RE.test(text)) score += 20;
  if (text.length >= 15) score += 10;

  const ctx = snippetContext?.toLowerCase() ?? '';
  if (ADDRESS_CONTEXT_RE.test(ctx)) score += 10;
  if (companyName && ctx.includes(companyName.toLowerCase())) score += 10;
  else if (domain) {
    const base = domain.split('.')[0].toLowerCase();
    if (base.length >= 4 && ctx.includes(base)) score += 5;
  }

  return score;
}

/**
 * Similarity between two address strings [0, 1].
 * Uses overlap ratio of significant tokens (lowercased words ≥ 3 chars).
 */
export function addressSimilarity(a: string, b: string): number {
  const tokens = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.min(ta.size, tb.size);
}

// Reject personal-address phrases from people-search / social sites.
const PERSONAL_ADDRESS_RE =
  /\bhome address\b|\bcurrently lives\b|\bresides at\b|\bassociates and relatives\b/i;

// Reject fragments ending with a US state abbreviation (", CA", ", TX", …).
const US_STATE_SUFFIX_RE =
  /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;

// Reject standalone 5-digit ZIP codes that are NOT preceded by "BG-" (Bulgarian postal codes are 4-digit).
const US_ZIP_RE = /(?<!BG-\s*)\b\d{5}\b/;

// Reject fragments that explicitly name a foreign country — these are partner/distributor addresses,
// not the Bulgarian company's own address (e.g. "Rua Victória 308, Nova Lima, MG, Brazil").
const FOREIGN_COUNTRY_RE =
  /\b(?:Brazil|Brasil|Germany|Deutschland|China|France|Italia|Italy|España|Spain|Portugal|United\s+States|USA|United\s+Kingdom|UK|Australia|Canada|Japan|Russia|Россия|Netherlands|Belgium|Austria|Switzerland|Sweden|Norway|Denmark|Finland|Poland|Romania|Hungary|Czech|Slovakia|Serbia|Croatia|Greece|Turkey)\b/i;

/**
 * Extract and score address candidates from search result titles + snippets.
 * Splits on newlines and pipe separators; deduplicates by similarity.
 * Returns candidates sorted by score descending.
 */
export function parseAddressCandidates(
  results: SearchResult[],
  domain: string,
  companyName?: string,
): AddressCandidate[] {
  const candidates: AddressCandidate[] = [];

  for (const result of results) {
    const fullContext = ((result.title ?? '') + '\n' + (result.snippet ?? '')).trim();
    if (!fullContext) continue;

    const fragments = fullContext
      // Also split on middle-dot navigation bullets (·) and ellipsis (… or ...)
      // so that "Компания · Колекция · ... Адрес: X" breaks into separate fragments.
      .split(/[\n\r|·…]|\.{3,}/)
      .map((f) => f.trim())
      .filter((f) => f.length >= 5 && f.length < 200);

    for (const fragment of fragments) {
      const cleaned = cleanAddressArtifacts(fragment.replace(/[,;]\s*$/, '').trim());
      if (cleaned.length < 5 || looksLikeTimeline(cleaned)) continue;

      // Reject US / personal-data / foreign-country address fragments.
      if (PERSONAL_ADDRESS_RE.test(cleaned)) continue;
      if (US_STATE_SUFFIX_RE.test(cleaned)) continue;
      if (US_ZIP_RE.test(cleaned)) continue;
      if (FOREIGN_COUNTRY_RE.test(cleaned)) continue;

      const score = scoreAddress(cleaned, fullContext, companyName, domain);
      if (score < 50) continue;

      if (!candidates.some((c) => addressSimilarity(c.text, cleaned) >= 0.7)) {
        candidates.push({ text: cleaned, score });
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * Enrich or validate the company address using web search.
 *
 * Flow:
 *   1. Score the existing website location (if any).
 *   2. If website score > 0 (any address found on site), trust it and skip search entirely.
 *   3. Search is fired ONLY when website location is null or empty.
 *
 * The optional `searchFn` parameter enables test injection.
 */
export async function enrichAddress(
  profile: Pick<ExtractedProfile, 'location' | 'name'>,
  domain: string,
  searchFn: (q: string) => Promise<SearchResult[]> = rawSearch,
): Promise<AddressEnrichmentResult> {
  // Clean map-widget artefacts (Distance:, pipe-duplicates) from the website
  // location so scoring and comparison work on the canonical address string.
  const websiteLocation = profile.location
    ? cleanAddressArtifacts(profile.location)
    : undefined;
  const identifier = profile.name ?? domain.split('.')[0];

  console.log(`[address] ${domain} website location=${websiteLocation ?? 'null'}`);

  const websiteScore = websiteLocation
    ? scoreAddress(websiteLocation, undefined, profile.name, domain)
    : 0;

  // Website address always takes priority — skip search entirely if any address was found.
  if (websiteScore > 0) {
    console.log(`[address] ${domain} website location trusted (score=${websiteScore}), skipping search`);
    return { location: websiteLocation, source: 'website', confidence: websiteScore, searchCandidates: [] };
  }

  const allCandidates: AddressCandidate[] = [];
  const queries = [`"${identifier}" адрес`, `"${identifier}" address`];

  for (const query of queries) {
    try {
      const results = await searchFn(query);
      allCandidates.push(...parseAddressCandidates(results, domain, profile.name));
    } catch { /* non-critical */ }
  }

  // Re-sort merged candidates across both queries and deduplicate again
  const deduped: AddressCandidate[] = [];
  for (const c of allCandidates.sort((a, b) => b.score - a.score)) {
    if (!deduped.some((d) => addressSimilarity(d.text, c.text) >= 0.7)) deduped.push(c);
  }

  console.log(
    `[address] ${domain} search candidates=[${deduped.map((c) => `"${c.text}"(${c.score})`).join(', ')}]`,
  );

  const searchCandidates = deduped.map((c) => c.text);

  if (deduped.length === 0) {
    return { source: 'none', confidence: 0, searchCandidates: [] };
  }

  const best = deduped[0];
  console.log(`[address] ${domain} selected="${best.text}" source=search confidence=${best.score}`);
  return { location: best.text, source: 'search', confidence: best.score, searchCandidates };
}
