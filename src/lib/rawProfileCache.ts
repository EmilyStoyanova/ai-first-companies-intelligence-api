// Raw page-level cache: a specific URL is considered fresh for 7 days.
// This is a shorter window than the CompanyProfile cache (30 days) because
// individual pages change more frequently than AI-extracted summaries.
export const RAW_PROFILE_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

export type RawProfileAction =
  | 'skip'   // fresh record exists — reuse, no HTTP request needed
  | 'update' // stale record exists — refresh in place, no new row
  | 'create'; // no record — insert a new row

export interface ExistingRawProfile {
  id: string;
  updatedAt: Date;
}

/**
 * Pure, DB-free decision: what to do when upserting a raw profile page.
 *
 *   'skip'   — record exists and updatedAt < 7 days ago
 *   'update' — record exists but updatedAt ≥ 7 days ago
 *   'create' — no existing record found
 *
 * @param existing  Result of findUnique for (companyId, normalizedUrl), or null.
 * @param nowMs     Current epoch ms; injectable for deterministic tests.
 */
export function rawProfileCacheDecision(
  existing: ExistingRawProfile | null,
  nowMs: number = Date.now(),
): RawProfileAction {
  if (!existing) return 'create';
  const ageMs = nowMs - existing.updatedAt.getTime();
  return ageMs < RAW_PROFILE_FRESHNESS_MS ? 'skip' : 'update';
}
