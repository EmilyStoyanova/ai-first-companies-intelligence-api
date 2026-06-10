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
const STREET_SIGNAL_RE =
  /(?:ул|бул|пл|кв|ж\.к|жк)\.\s*\S|(?:ul|str|bul|blvd?)\.\s*\w|\b(?:street|avenue|boulevard|road|drive|lane|plaza)\b|(?:адрес|address|headquarters?)\s*:|офис\s+\d|office\s+\d/iu;

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
 *   2. If website score ≥ 60, trust it and skip the search API entirely.
 *   3. Otherwise fire two search queries ("адрес" + "address").
 *   4. Compare website and best search candidate:
 *      - Similar addresses → keep website (direct source is more reliable).
 *      - Search score > website score + 20 → use search, log conflict note.
 *      - Otherwise → keep website.
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

  if (websiteScore >= 60) {
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
    if (websiteLocation && websiteScore > 0) {
      console.log(`[address] ${domain} selected="${websiteLocation}" source=website confidence=${websiteScore}`);
      return { location: websiteLocation, source: 'website', confidence: websiteScore, searchCandidates: [] };
    }
    return { source: 'none', confidence: 0, searchCandidates: [] };
  }

  const best = deduped[0];

  if (!websiteLocation || websiteScore === 0) {
    console.log(`[address] ${domain} selected="${best.text}" source=search confidence=${best.score}`);
    return { location: best.text, source: 'search', confidence: best.score, searchCandidates };
  }

  // Website has no street indicator (city-only, generic text) but search found
  // a real postal address — upgrade unconditionally.
  if (websiteScore < 50 && best.score >= 50) {
    const note = `weak website="${websiteLocation}" replaced by search`;
    console.log(`[address] ${domain} conflict — ${note} (search ${best.score} > websiteScore ${websiteScore})`);
    return { location: best.text, source: 'search', confidence: best.score, note, searchCandidates };
  }

  const sim = addressSimilarity(websiteLocation, best.text);
  if (sim >= 0.5) {
    // Same address, different wording → keep website (it's the direct source)
    console.log(
      `[address] ${domain} selected="${websiteLocation}" source=website confidence=${websiteScore} (matches search)`,
    );
    return { location: websiteLocation, source: 'website', confidence: websiteScore, searchCandidates };
  }

  if (best.score > websiteScore + 20) {
    // Search is meaningfully better → replace
    const note = `website="${websiteLocation}" vs search="${best.text}"`;
    console.log(
      `[address] ${domain} conflict — ${note} → taking search (${best.score} > ${websiteScore}+20)`,
    );
    return { location: best.text, source: 'search', confidence: best.score, note, searchCandidates };
  }

  console.log(`[address] ${domain} selected="${websiteLocation}" source=website confidence=${websiteScore}`);
  return { location: websiteLocation, source: 'website', confidence: websiteScore, searchCandidates };
}
