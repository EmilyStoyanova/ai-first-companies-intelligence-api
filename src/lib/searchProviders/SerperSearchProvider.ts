import type { SearchProvider, SearchResult, SearchOptions } from './types';
import { SearchProviderError } from './types';

export class SerperSearchProvider implements SearchProvider {
  readonly name = 'serper';

  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.SERPER_API_KEY ?? '';
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (!this.apiKey) {
      throw new SearchProviderError('unavailable', 'Serper: no API key configured');
    }

    const body: Record<string, unknown> = { q: query, num: options.num ?? 5 };
    if (options.country) body['gl'] = options.country;
    if (options.language) body['hl'] = options.language;

    let res: Response;
    try {
      res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': this.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (err) {
      throw new SearchProviderError('unavailable', `Serper: network error — ${(err as Error).message}`);
    }

    if (res.status === 429) throw new SearchProviderError('rate_limited', 'Serper: rate limited (429)');
    if (res.status === 402) throw new SearchProviderError('quota_exceeded', 'Serper: quota exceeded (402)');
    if (!res.ok) throw new SearchProviderError('unavailable', `Serper: HTTP ${res.status}`);

    const data = await res.json() as {
      organic?: Array<{ link: string; title?: string; snippet?: string }>;
    };

    return (data.organic ?? []).map(r => ({
      url: r.link,
      title: r.title,
      snippet: r.snippet,
    }));
  }
}
