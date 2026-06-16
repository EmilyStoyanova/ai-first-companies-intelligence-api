import { PageClassifier } from './PageClassifier';
import { OrganizationExtractor } from './OrganizationExtractor';
import { CandidateNormalizer } from './CandidateNormalizer';
import { CandidateQualifier } from './CandidateQualifier';
import { SearchDiscoverySource } from './sources/SearchDiscoverySource';
import { EducationRegistrySource } from './sources/EducationRegistrySource';
import type {
  DiscoverySource,
  DiscoverySourceResult,
  OrchestrationResult,
  PageType,
  PersonaSearchInput,
} from './types';
import { SearchProviderError } from '../discovery';

export type { PersonaSearchInput, DiscoverySourceResult, OrchestrationResult } from './types';
export { SearchProviderError };

const PAGE_FETCH_TIMEOUT_MS = 10_000;
// Max number of suspected municipality/directory pages to fetch HTML for per run.
// Avoids excessive latency when many search results look like list pages.
const MAX_PAGES_TO_FETCH = 5;

async function fetchPageHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BizDevBot/1.0; +https://ludogoriesoft.com)' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Coordinates the full discovery pipeline for a persona search.
 *
 * Flow:
 *  1. Collect raw candidates from all applicable DiscoverySources
 *  2. Meta-classify each UNKNOWN candidate (URL + title + snippet, no HTTP)
 *  3. Fetch HTML for suspected municipality/directory pages (up to MAX_PAGES_TO_FETCH)
 *  4. Deep-classify fetched pages and extract organization candidates from them
 *  5. Merge all candidates (direct + extracted)
 *  6. Normalize (deduplicate by domain / email / normalized name)
 *  7. Qualify (accept/reject each candidate)
 *  8. Return OrchestrationResult
 */
export class DiscoveryOrchestrator {
  private readonly sources: DiscoverySource[];
  private readonly classifier: PageClassifier;
  private readonly extractor: OrganizationExtractor;
  private readonly normalizer: CandidateNormalizer;
  private readonly qualifier: CandidateQualifier;

  constructor(sources?: DiscoverySource[]) {
    this.classifier = new PageClassifier();
    this.extractor  = new OrganizationExtractor();
    this.normalizer = new CandidateNormalizer();
    this.qualifier  = new CandidateQualifier();
    this.sources = sources ?? [
      new SearchDiscoverySource(),
      new EducationRegistrySource(),
    ];
  }

  async discover(input: PersonaSearchInput): Promise<OrchestrationResult> {
    console.log(
      `[discovery] input category="${input.persona}" location="${input.location}"` +
      (input.keywords ? ` keywords="${input.keywords}"` : ''),
    );

    // ── Step 1: Collect raw candidates ──────────────────────────────────────
    const rawCandidates: DiscoverySourceResult[] = [];

    const applicableSources = this.sources.filter(s => s.canHandle(input));
    console.log(`[discovery] using sources: ${applicableSources.map(s => s.name).join(', ')}`);

    // Run SearchDiscoverySource first (may throw SearchProviderError)
    for (const source of applicableSources) {
      try {
        console.log(`[discovery] source=${source.name}`);
        const results = await source.discover(input);
        rawCandidates.push(...results);
        console.log(`[discovery] source=${source.name} returned ${results.length} candidates`);
      } catch (err) {
        if (err instanceof SearchProviderError) throw err; // propagate to worker
        console.error(`[discovery] source ${source.name} failed — skipping:`, err);
      }
    }

    // ── Step 2: Meta-classify UNKNOWN candidates; try to upgrade IRRELEVANT ones ─
    // IRRELEVANT candidates from SKIP_DOMAINS may still be useful list pages (e.g.
    // registarnadetskitegradini.com, детскиградини.бг). We detect those by hostname
    // signals and upgrade them to DIRECTORY_OR_PORTAL / OFFICIAL_REGISTRY so the
    // orchestrator fetches them and extracts real organizations. We never upgrade to
    // TARGET_ORGANIZATION and never leave them as UNKNOWN (which would let them pass QA).
    const LIST_PAGE_TYPES: PageType[] = ['DIRECTORY_OR_PORTAL', 'OFFICIAL_REGISTRY', 'MUNICIPALITY_PAGE'];

    const metaClassified = rawCandidates.map(c => {
      if (c.pageType !== 'UNKNOWN' && c.pageType !== 'IRRELEVANT') return c;

      const pageType = this.classifier.classifyFromMeta(
        c.sourceUrl, c.title ?? '', c.snippet ?? '', input,
      );

      if (c.pageType === 'IRRELEVANT') {
        if (LIST_PAGE_TYPES.includes(pageType)) {
          console.log(`[discovery] upgraded IRRELEVANT url=${c.sourceUrl} → ${pageType} (hostname signals)`);
          return { ...c, pageType };
        }
        return c; // stay IRRELEVANT — genuinely not useful
      }

      // UNKNOWN candidate
      if (pageType !== 'UNKNOWN') {
        console.log(`[discovery] classified url=${c.sourceUrl} type=${pageType} (meta)`);
      }
      return { ...c, pageType };
    });

    // ── Step 3: Fetch HTML for suspected list pages ──────────────────────────

    // Deduplicate suspects by URL and limit to MAX_PAGES_TO_FETCH
    const suspectUrls = new Set<string>();
    const suspects = metaClassified
      .filter(c => LIST_PAGE_TYPES.includes(c.pageType))
      .filter(c => {
        if (suspectUrls.has(c.sourceUrl)) return false;
        suspectUrls.add(c.sourceUrl);
        return true;
      })
      .slice(0, MAX_PAGES_TO_FETCH);

    const extractedOrgs: DiscoverySourceResult[] = [];
    const confirmedPageTypes = new Map<string, PageType>();

    if (suspects.length > 0) {
      console.log(`[discovery] fetching HTML for ${suspects.length} suspected list pages`);

      await Promise.all(suspects.map(async (candidate) => {
        const html = await fetchPageHtml(candidate.sourceUrl);
        if (!html) return;

        const contentType = this.classifier.classifyFromContent(html, candidate.sourceUrl, input);
        confirmedPageTypes.set(candidate.sourceUrl, contentType);
        console.log(`[discovery] classified url=${candidate.sourceUrl} type=${contentType} (content)`);

        if (LIST_PAGE_TYPES.includes(contentType)) {
          console.log(`[discovery] rejected ${candidate.sourceUrl} as lead — is a ${contentType}`);
          const orgs = await this.extractor.extractOrganizations(html, candidate.sourceUrl, input);
          console.log(
            `[discovery] extracted ${orgs.length} organizations from ${contentType.toLowerCase()} page ${candidate.sourceUrl}`,
          );
          for (const org of orgs) {
            console.log(
              `[discovery] accepted candidate name="${org.name}" confidence=${org.confidence}` +
              (org.email ? ` email=${org.email}` : '') +
              (org.phone ? ` phone=${org.phone}` : ''),
            );
          }
          extractedOrgs.push(...orgs);
        }
      }));
    }

    // Update confirmed page types on original candidates
    const withConfirmedTypes = metaClassified.map(c => {
      const confirmed = confirmedPageTypes.get(c.sourceUrl);
      return confirmed ? { ...c, pageType: confirmed } : c;
    });

    // ── Step 4: Merge all candidates ─────────────────────────────────────────
    const allRaw = [...withConfirmedTypes, ...extractedOrgs];

    // ── Step 5: Normalize (deduplicate) ──────────────────────────────────────
    const normalized = this.normalizer.normalize(allRaw);
    console.log(
      `[discovery] normalized: ${allRaw.length} raw candidates → ${normalized.length} after deduplication`,
    );

    // ── Step 6: Qualify ───────────────────────────────────────────────────────
    const accepted: DiscoverySourceResult[] = [];
    const rejected: DiscoverySourceResult[] = [];

    for (const candidate of normalized) {
      const { accepted: ok, reason } = this.qualifier.qualify(candidate, input);
      if (ok) {
        accepted.push(candidate);
        if (candidate.domain) {
          console.log(
            `[discovery] accepted candidate name="${candidate.name ?? candidate.domain}" ` +
            `confidence=${candidate.confidence} domain=${candidate.domain}`,
          );
        }
      } else {
        rejected.push({ ...candidate, rejectedReason: reason });
        console.log(
          `[discovery] rejected candidate url=${candidate.sourceUrl} reason=${reason}`,
        );
      }
    }

    console.log(
      `[discovery] result: ${accepted.length} accepted, ${rejected.length} rejected ` +
      `(${extractedOrgs.length} extracted from list pages)`,
    );

    return { accepted, rejected, allCandidates: normalized };
  }
}
