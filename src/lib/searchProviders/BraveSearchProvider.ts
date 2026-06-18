import type { SearchProvider, SearchResult, SearchOptions } from './types';
import { SearchProviderError } from './types';

export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave';

  private readonly apiKey: string;

  constructor(apiKey?: string) {
    // Support both BRAVE_API_KEY (new) and BRAVE_SEARCH_API_KEY (legacy)
    this.apiKey = apiKey ?? process.env.BRAVE_API_KEY ?? process.env.BRAVE_SEARCH_API_KEY ?? '';
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (!this.apiKey) {
      throw new SearchProviderError('unavailable', 'Brave: no API key configured');
    }

    const params = new URLSearchParams({ q: query, count: String(options.num ?? 5) });
    if (options.country) params.set('country', options.country);
    if (options.language) params.set('search_lang', options.language);

    let res: Response;
    try {
      res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': this.apiKey },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (err) {
      throw new SearchProviderError('unavailable', `Brave: network error — ${(err as Error).message}`);
    }

    if (res.status === 429) throw new SearchProviderError('rate_limited', 'Brave: rate limited (429)');
    if (res.status === 402) throw new SearchProviderError('quota_exceeded', 'Brave: quota exceeded (402)');
    if (!res.ok) throw new SearchProviderError('unavailable', `Brave: HTTP ${res.status}`);

    const data = await res.json() as {
      web?: { results?: Array<{ url: string; title?: string; description?: string }> };
    };

    return (data.web?.results ?? []).map(r => ({
      url: r.url,
      title: r.title,
      snippet: r.description,
    }));
  }
}
