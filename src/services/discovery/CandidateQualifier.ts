import type { DiscoverySourceResult, PersonaSearchInput } from './types';

const MIN_CONFIDENCE = 40;

// Synthetic domains used for extracted orgs that have no known website
const SYNTHETIC_DOMAIN_SUFFIX = '.local';

function extractDomain(url: string): string | undefined {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return undefined; }
}

/**
 * Decides whether a discovery candidate is an acceptable lead.
 *
 * Accept if:
 *  - pageType is TARGET_ORGANIZATION (or extracted from a list page)
 *  - confidence >= MIN_CONFIDENCE
 *  - has at least one useful signal: domain, email, or phone
 *  - not a municipality/directory/news/social/irrelevant page itself
 *    (unless it was EXTRACTED from such a page, in which case extractedFromUrl is set)
 *
 * Reject with reason if any of the above fail.
 */
export class CandidateQualifier {
  qualify(
    candidate: DiscoverySourceResult,
    _input: PersonaSearchInput,
  ): { accepted: boolean; reason?: string } {
    const isExtracted = !!candidate.extractedFromUrl;

    // Always reject municipality/directory/news pages that are the top-level search result
    // (not orgs extracted FROM such pages)
    if (!isExtracted) {
      if (candidate.pageType === 'MUNICIPALITY_PAGE') {
        return { accepted: false, reason: 'municipality_page' };
      }
      if (candidate.pageType === 'DIRECTORY_OR_PORTAL') {
        return { accepted: false, reason: 'directory_or_portal' };
      }
      if (candidate.pageType === 'NEWS_ARTICLE') {
        return { accepted: false, reason: 'news_article' };
      }
      if (candidate.pageType === 'SOCIAL_PAGE') {
        return { accepted: false, reason: 'social_page' };
      }
      if (candidate.pageType === 'IRRELEVANT') {
        return { accepted: false, reason: 'irrelevant' };
      }
    }

    // An org extracted from a page but pointing back to the same domain is just a
    // link within the source site (e.g. a section heading or internal navigation) —
    // not a separate organization.
    if (isExtracted && candidate.domain && candidate.extractedFromUrl) {
      const sourceDomain = extractDomain(candidate.extractedFromUrl);
      if (sourceDomain && candidate.domain === sourceDomain) {
        return { accepted: false, reason: 'same_domain_as_source' };
      }
    }

    // Confidence threshold
    if (candidate.confidence < MIN_CONFIDENCE) {
      return { accepted: false, reason: `low_confidence(${candidate.confidence})` };
    }

    // Must have at least one contact / identity signal
    const hasSignal =
      (candidate.domain && !candidate.domain.endsWith(SYNTHETIC_DOMAIN_SUFFIX)) ||
      candidate.email ||
      candidate.phone;

    if (!hasSignal) {
      return { accepted: false, reason: 'no_contact_signal' };
    }

    return { accepted: true };
  }

  isAccepted(candidate: DiscoverySourceResult, input: PersonaSearchInput): boolean {
    return this.qualify(candidate, input).accepted;
  }
}
