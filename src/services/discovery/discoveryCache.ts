import { prisma } from '../../lib/prisma';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Finds a recent COMPLETED batch with the same discoveryKey.
 * Returns null on cache miss (no match, too old, no candidates, or FAILED batch).
 */
export async function findCachedDiscovery(
  currentBatchId: string,
  discoveryKey: string,
): Promise<{ id: string } | null> {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS);

  return prisma.crawlBatch.findFirst({
    where: {
      id:           { not: currentBatchId },
      discoveryKey,
      status:       'COMPLETED',
      updatedAt:    { gte: cutoff },
      discoveryCandidates: { some: {} },
    },
    orderBy: { updatedAt: 'desc' },
    select:  { id: true },
  });
}

/**
 * Copies all DiscoveryCandidates from sourceBatchId to targetBatchId.
 * Preserves all fields. Skips duplicates (same batchId+domain) safely.
 * Returns the number of rows actually inserted.
 */
export async function copyCandidatesToBatch(
  sourceBatchId: string,
  targetBatchId: string,
): Promise<number> {
  const candidates = await prisma.discoveryCandidate.findMany({
    where: { batchId: sourceBatchId },
  });

  if (candidates.length === 0) return 0;

  const rows = candidates.map(
    ({ id: _id, batchId: _b, createdAt: _c, ...rest }) => ({
      ...rest,
      batchId: targetBatchId,
    }),
  );

  const result = await prisma.discoveryCandidate.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return result.count;
}
