import { rawProfileCacheDecision, RAW_PROFILE_FRESHNESS_MS } from '../rawProfileCache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000; // fixed epoch for determinism

function updatedAt(msAgo: number): { id: string; updatedAt: Date } {
  return { id: 'rec-1', updatedAt: new Date(NOW - msAgo) };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 'create' — no existing record
// ---------------------------------------------------------------------------

describe("action 'create' — no existing record", () => {
  test('returns create when existing is null', () => {
    expect(rawProfileCacheDecision(null, NOW)).toBe('create');
  });
});

// ---------------------------------------------------------------------------
// 'skip' — fresh record (< 7 days)
// ---------------------------------------------------------------------------

describe("action 'skip' — fresh record", () => {
  test('skips record updated 1 hour ago', () => {
    expect(rawProfileCacheDecision(updatedAt(60 * 60 * 1000), NOW)).toBe('skip');
  });

  test('skips record updated 1 day ago', () => {
    expect(rawProfileCacheDecision(updatedAt(DAY_MS), NOW)).toBe('skip');
  });

  test('skips record updated 3 days ago', () => {
    expect(rawProfileCacheDecision(updatedAt(3 * DAY_MS), NOW)).toBe('skip');
  });

  test('skips record updated 6 days ago', () => {
    expect(rawProfileCacheDecision(updatedAt(6 * DAY_MS), NOW)).toBe('skip');
  });

  test('skips record updated 1 ms before the 7-day boundary', () => {
    expect(rawProfileCacheDecision(updatedAt(RAW_PROFILE_FRESHNESS_MS - 1), NOW)).toBe('skip');
  });
});

// ---------------------------------------------------------------------------
// 'update' — stale record (≥ 7 days)
// ---------------------------------------------------------------------------

describe("action 'update' — stale record", () => {
  test('updates record that is exactly 7 days old (at boundary)', () => {
    expect(rawProfileCacheDecision(updatedAt(RAW_PROFILE_FRESHNESS_MS), NOW)).toBe('update');
  });

  test('updates record that is 7 days + 1 ms old', () => {
    expect(rawProfileCacheDecision(updatedAt(RAW_PROFILE_FRESHNESS_MS + 1), NOW)).toBe('update');
  });

  test('updates record updated 8 days ago', () => {
    expect(rawProfileCacheDecision(updatedAt(8 * DAY_MS), NOW)).toBe('update');
  });

  test('updates record updated 30 days ago', () => {
    expect(rawProfileCacheDecision(updatedAt(30 * DAY_MS), NOW)).toBe('update');
  });

  test('updates record updated 1 year ago', () => {
    expect(rawProfileCacheDecision(updatedAt(365 * DAY_MS), NOW)).toBe('update');
  });
});

// ---------------------------------------------------------------------------
// Constant sanity
// ---------------------------------------------------------------------------

describe('RAW_PROFILE_FRESHNESS_MS constant', () => {
  test('is exactly 7 days in milliseconds', () => {
    expect(RAW_PROFILE_FRESHNESS_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// End-to-end scenario: same URL submitted twice for existing company
// ---------------------------------------------------------------------------

describe('existing company URL submitted again', () => {
  test('URL crawled 2 days ago → skip, do not re-fetch page', () => {
    const existing = updatedAt(2 * DAY_MS);
    expect(rawProfileCacheDecision(existing, NOW)).toBe('skip');
  });

  test('URL crawled 8 days ago → update existing row, do not create duplicate', () => {
    const existing = updatedAt(8 * DAY_MS);
    expect(rawProfileCacheDecision(existing, NOW)).toBe('update');
  });

  test('URL never seen before → create new row', () => {
    expect(rawProfileCacheDecision(null, NOW)).toBe('create');
  });

  test('update never results in a new row (action is not create)', () => {
    const existing = updatedAt(10 * DAY_MS);
    expect(rawProfileCacheDecision(existing, NOW)).not.toBe('create');
  });
});
