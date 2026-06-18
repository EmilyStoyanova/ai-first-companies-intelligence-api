export interface SearchResult {
  url: string;
  title?: string;
  snippet?: string;
}

export interface SearchOptions {
  num?: number;
  country?: string;
  language?: string;
}

export class SearchProviderError extends Error {
  constructor(
    public readonly reason: 'quota_exceeded' | 'rate_limited' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'SearchProviderError';
  }
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}
