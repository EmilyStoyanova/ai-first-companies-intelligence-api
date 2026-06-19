// Search abstraction used by enrichment and discovery flows.
// Active provider: Serper (SEARCH_PRIMARY_PROVIDER=serper). No fallback until SearXNG is available on production server.
// Use cachedSearch() to avoid redundant API calls; rawSearch() bypasses the cache.

import { prisma } from './prisma';
import type { Prisma } from '@prisma/client';
import { BraveSearchProvider } from './searchProviders/BraveSearchProvider';
import { SerperSearchProvider } from './searchProviders/SerperSearchProvider';
import { SearchProviderRouter } from './searchProviders/SearchProviderRouter';
import type { SearchOptions } from './searchProviders/types';

export type { SearchResult } from './searchProviders/types';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildRouter(): SearchProviderRouter {
  const primaryName = (
    process.env.SEARCH_PRIMARY_PROVIDER ?? process.env.SEARCH_PROVIDER ?? 'brave'
  ).toLowerCase();

  const fallbackName = (process.env.SEARCH_FALLBACK_PROVIDER ?? 'serper').toLowerCase();

  const providers = {
    brave: () => new BraveSearchProvider(),
    serper: () => new SerperSearchProvider(),
  } as Record<string, () => BraveSearchProvider | SerperSearchProvider>;

  const primary = (providers[primaryName] ?? providers['brave'])();
  const fallback = primaryName !== fallbackName ? (providers[fallbackName] ?? providers['serper'])() : null;

  return new SearchProviderRouter(primary, fallback);
}

/**
 * Cache-aware search. Checks SearchCache before hitting any external provider.
 * Freshness window: 7 days. On miss or stale, routes through Brave → Serper fallback.
 */
export async function cachedSearch(query: string, options?: SearchOptions): Promise<import('./searchProviders/types').SearchResult[]> {
  const normalizedQuery = normalizeQuery(query);

  try {
    const cached = await prisma.searchCache.findUnique({ where: { normalizedQuery } });

    if (cached) {
      const ageMs = Date.now() - cached.lastSearchedAt.getTime();
      const ageDays = Math.round(ageMs / (24 * 60 * 60 * 1000));

      if (ageMs <= SEVEN_DAYS_MS) {
        console.log(`[cache] hit query="${normalizedQuery}" age=${ageDays}d provider=${cached.providerUsed ?? 'unknown'}`);
        return cached.results as unknown as import('./searchProviders/types').SearchResult[];
      }

      console.log(`[cache] stale query="${normalizedQuery}" age=${ageDays}d refreshing`);
      const { results, providerUsed } = await buildRouter().search(query, options);
      await prisma.searchCache.update({
        where: { normalizedQuery },
        data: {
          results: results as unknown as Prisma.InputJsonValue,
          lastSearchedAt: new Date(),
          providerUsed,
        },
      });
      console.log(`[cache] updated query="${normalizedQuery}" provider=${providerUsed}`);
      return results;
    }

    console.log(`[cache] miss query="${normalizedQuery}"`);
    const { results, providerUsed } = await buildRouter().search(query, options);
    await prisma.searchCache.create({
      data: {
        normalizedQuery,
        results: results as unknown as Prisma.InputJsonValue,
        providerUsed,
      },
    });
    return results;
  } catch (err) {
    console.warn(`[cache] error, falling back to rawSearch: ${(err as Error).message}`);
    return rawSearch(query, options);
  }
}

export async function rawSearch(query: string, options?: SearchOptions): Promise<import('./searchProviders/types').SearchResult[]> {
  const { results } = await buildRouter().search(query, options);
  return results;
}
