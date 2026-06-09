// Shared search provider abstraction used by social enrichment and login fallback enrichment.
// Supports Brave Search (default) and Serper (Google) via SEARCH_PROVIDER env var.

export interface SearchResult {
  url: string;
  title?: string;
  snippet?: string;
}

export async function rawSearch(query: string): Promise<SearchResult[]> {
  const provider = process.env.SEARCH_PROVIDER?.toLowerCase() === 'serper' ? 'serper' : 'brave';

  if (provider === 'serper') {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return [];
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({ q: query, num: 5 }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      organic?: Array<{ link: string; title?: string; snippet?: string }>;
    };
    return (data.organic ?? []).map((r) => ({ url: r.link, title: r.title, snippet: r.snippet }));
  }

  // Default: Brave Search
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const data = await res.json() as {
    web?: { results?: Array<{ url: string; title?: string; description?: string }> };
  };
  return (data.web?.results ?? []).map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.description,
  }));
}
