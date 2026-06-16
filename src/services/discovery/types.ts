export type PageType =
  | 'TARGET_ORGANIZATION'
  | 'OFFICIAL_REGISTRY'
  | 'MUNICIPALITY_PAGE'
  | 'DIRECTORY_OR_PORTAL'
  | 'NEWS_ARTICLE'
  | 'SOCIAL_PAGE'
  | 'IRRELEVANT'
  | 'UNKNOWN';

export interface PersonaSearchInput {
  persona: string;
  location: string;
  keywords?: string;
  maxResults?: number;
}

/** A single candidate produced by any discovery source. */
export interface DiscoverySourceResult {
  /** Human-readable organization name (key field for extracted orgs). */
  name?: string;
  /** Hostname without www. E.g. "dg-slance.bg". Undefined for orgs with no known website. */
  domain?: string;
  /** Full URL of the organization's website or contact page. */
  websiteUrl?: string;
  /** Direct URL to a contact/about page if different from websiteUrl. */
  contactPageUrl?: string;
  /** Pre-crawl email discovered during page extraction. */
  email?: string;
  /** Pre-crawl phone discovered during page extraction. */
  phone?: string;
  /** Pre-crawl address discovered during page extraction. */
  address?: string;
  /** URL of the search result or registry page this candidate came from. */
  sourceUrl: string;
  /** How this candidate was found. */
  sourceType: 'registry' | 'search' | 'municipality' | 'directory' | 'manual';
  /** 0-100 confidence that this is a valid target organization. */
  confidence: number;
  /** Classification of the page at sourceUrl. */
  pageType: PageType;
  /** URL of the parent list page when this org was extracted from a directory/municipality page. */
  extractedFromUrl?: string;
  /** Title / heading from the search result or page. */
  title?: string;
  /** Snippet / short description from the search result. */
  snippet?: string;
  /** Reason this candidate was rejected (populated by CandidateQualifier). */
  rejectedReason?: string;
}

/** A pluggable source that produces discovery candidates. */
export interface DiscoverySource {
  readonly name: string;
  canHandle(input: PersonaSearchInput): boolean;
  discover(input: PersonaSearchInput): Promise<DiscoverySourceResult[]>;
}

export interface OrchestrationResult {
  /** Candidates that passed qualification — ready to upsert as Companies and enqueue for crawling. */
  accepted: DiscoverySourceResult[];
  /** Candidates that were rejected with a reason (municipality pages, news, low confidence, etc.). */
  rejected: DiscoverySourceResult[];
  /** All candidates including rejected — persisted to DB for UI transparency. */
  allCandidates: DiscoverySourceResult[];
}
