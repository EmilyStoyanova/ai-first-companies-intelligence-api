// Note: imports from ../../discovery resolve to src/services/discovery.ts (the existing file),
// NOT to this directory — TypeScript resolves the .ts file before the folder.
import { discoverSites } from '../../discovery';
import type { DiscoverySource, DiscoverySourceResult, PageType, PersonaSearchInput } from '../types';

function mapRejectionToPageType(reason: string | undefined): PageType {
  switch (reason) {
    case 'MUNICIPALITY':       return 'MUNICIPALITY_PAGE';
    case 'DIRECTORY':          return 'DIRECTORY_OR_PORTAL';
    case 'NEWS_SITE':          return 'NEWS_ARTICLE';
    case 'EDUCATION_PORTAL':   return 'OFFICIAL_REGISTRY';
    case 'AGGREGATOR':         return 'DIRECTORY_OR_PORTAL';
    case 'LOCATION_MISMATCH':  return 'IRRELEVANT';
    default:                   return 'UNKNOWN';
  }
}

/**
 * Wraps the existing discoverSites() (Brave / Serper search + Groq filter)
 * and maps its output to the new DiscoverySourceResult interface.
 *
 * Always available as the fallback source.
 */
export class SearchDiscoverySource implements DiscoverySource {
  readonly name = 'SearchDiscoverySource';

  canHandle(_input: PersonaSearchInput): boolean {
    return true;
  }

  async discover(input: PersonaSearchInput): Promise<DiscoverySourceResult[]> {
    const raw = await discoverSites({
      persona:    input.persona,
      location:   input.location,
      keywords:   input.keywords,
      maxResults: input.maxResults,
    });

    return raw.map((site): DiscoverySourceResult => {
      let pageType: PageType;
      let confidence: number;

      if (site.status === 'blocked') {
        pageType = 'IRRELEVANT';
        confidence = 0;
      } else if (site.status === 'filtered') {
        pageType = mapRejectionToPageType(site.rejectionReason);
        confidence = 20;
      } else {
        // 'kept' — Groq decided this looks like a real org; pageType will be
        // further refined by PageClassifier in the orchestrator
        pageType = 'UNKNOWN';
        confidence = 70;
      }

      return {
        name:       site.title,
        domain:     site.domain,
        websiteUrl: `https://${site.domain}`,
        sourceUrl:  site.url,
        sourceType: 'search',
        confidence,
        pageType,
        title:   site.title,
        snippet: site.snippet,
        rejectedReason: site.rejectionReason,
      };
    });
  }
}
