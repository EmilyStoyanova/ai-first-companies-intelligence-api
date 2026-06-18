import type { SearchProvider, SearchResult, SearchOptions } from './types';
import { SearchProviderError } from './types';

// ---------------------------------------------------------------------------
// Metrics — module-level so all router instances contribute to the same counters
// ---------------------------------------------------------------------------

export const searchMetrics = {
  primaryRequests: 0,
  primarySuccesses: 0,
  primaryFailures: 0,
  fallbackRequests: 0,
  fallbackSuccesses: 0,
  fallbackFailures: 0,
  get fallbackRate(): number {
    return this.primaryRequests === 0 ? 0 : this.fallbackRequests / this.primaryRequests;
  },
  reset() {
    this.primaryRequests = 0;
    this.primarySuccesses = 0;
    this.primaryFailures = 0;
    this.fallbackRequests = 0;
    this.fallbackSuccesses = 0;
    this.fallbackFailures = 0;
  },
  log() {
    console.log(
      `[search:metrics] primaryRequests=${this.primaryRequests}` +
      ` primarySuccesses=${this.primarySuccesses}` +
      ` primaryFailures=${this.primaryFailures}` +
      ` fallbackRequests=${this.fallbackRequests}` +
      ` fallbackRate=${(this.fallbackRate * 100).toFixed(1)}%`,
    );
  },
};

// ---------------------------------------------------------------------------
// Router result — includes which provider actually served the response
// ---------------------------------------------------------------------------

export interface RouterResult {
  results: SearchResult[];
  providerUsed: string;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class SearchProviderRouter {
  constructor(
    private readonly primary: SearchProvider,
    private readonly fallback: SearchProvider | null = null,
  ) {}

  async search(query: string, options?: SearchOptions): Promise<RouterResult> {
    searchMetrics.primaryRequests++;
    console.log(`[search] provider=${this.primary.name} query="${query}"`);

    try {
      const results = await this.primary.search(query, options);
      searchMetrics.primarySuccesses++;
      console.log(`[search] provider=${this.primary.name} success results=${results.length}`);
      return { results, providerUsed: this.primary.name };
    } catch (err) {
      searchMetrics.primaryFailures++;

      if (err instanceof SearchProviderError) {
        console.warn(`[search] provider=${this.primary.name} ${err.reason}: ${err.message}`);
      } else {
        console.warn(`[search] provider=${this.primary.name} error: ${(err as Error).message}`);
      }

      if (!this.fallback) throw err;

      console.log(`[search] fallback_to=${this.fallback.name}`);
      searchMetrics.fallbackRequests++;

      try {
        const results = await this.fallback.search(query, options);
        searchMetrics.fallbackSuccesses++;
        console.log(`[search] provider=${this.fallback.name} success results=${results.length}`);
        return { results, providerUsed: this.fallback.name };
      } catch (fallbackErr) {
        searchMetrics.fallbackFailures++;
        console.error(`[search] provider=${this.fallback.name} failed: ${(fallbackErr as Error).message}`);
        throw fallbackErr;
      }
    }
  }
}
