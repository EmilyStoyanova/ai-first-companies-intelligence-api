import { checkFreshness, COMPLETION_SCORE_THRESHOLD, COMPANY_PROFILE_FRESHNESS_MS } from '../freshness';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAYS = (n: number) => n * 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - DAYS(n));
}

/** A fully complete profile — all fields populated, high score */
const goodProfile = {
  completionScore: 80,
  emails: ['info@company.bg'],
  phones: ['+359 888 123 456'],
  name: 'Acme OOD',
  description: 'A Bulgarian company.',
};

/** Minimal company that should be SKIPPED (fresh, complete, good status) */
function freshGoodCompany(daysOld = 10) {
  return {
    crawlStatus: 'COMPLETED',
    lastCrawledAt: daysAgo(daysOld),
    profile: goodProfile,
  };
}

// ---------------------------------------------------------------------------
// forceRecrawl
// ---------------------------------------------------------------------------

describe('forceRecrawl', () => {
  test('always re-crawls when forceRecrawl=true, even if profile is fresh and complete', () => {
    const result = checkFreshness(freshGoodCompany(1), true);
    expect(result.skip).toBe(false);
    expect(result.reason).toContain('force_recrawl');
  });
});

// ---------------------------------------------------------------------------
// crawlStatus gate
// ---------------------------------------------------------------------------

describe('crawlStatus gate', () => {
  test.each(['FAILED', 'BLOCKED', 'PENDING'] as const)(
    'always re-crawls when crawlStatus=%s',
    (status) => {
      const company = { ...freshGoodCompany(), crawlStatus: status };
      expect(checkFreshness(company, false).skip).toBe(false);
    },
  );

  test('allows skip when crawlStatus=COMPLETED', () => {
    expect(checkFreshness(freshGoodCompany(), false).skip).toBe(true);
  });

  test('allows skip when crawlStatus=CRAWLING (edge — already in flight)', () => {
    const company = { ...freshGoodCompany(), crawlStatus: 'CRAWLING' };
    expect(checkFreshness(company, false).skip).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 30-day freshness window (CompanyProfile cache)
// ---------------------------------------------------------------------------

describe('30-day freshness window', () => {
  test('skips company crawled 1 day ago (fresh)', () => {
    expect(checkFreshness(freshGoodCompany(1), false).skip).toBe(true);
  });

  test('skips company crawled 15 days ago (within 30-day window)', () => {
    expect(checkFreshness(freshGoodCompany(15), false).skip).toBe(true);
  });

  test('skips company crawled 29 days ago (still within window)', () => {
    expect(checkFreshness(freshGoodCompany(29), false).skip).toBe(true);
  });

  test('re-crawls company crawled exactly 30 days ago (at boundary)', () => {
    const company = {
      ...freshGoodCompany(),
      lastCrawledAt: new Date(Date.now() - COMPANY_PROFILE_FRESHNESS_MS),
    };
    expect(checkFreshness(company, false).skip).toBe(false);
    expect(checkFreshness(company, false).reason).toContain('30 days');
  });

  test('re-crawls company crawled 31 days ago (stale)', () => {
    expect(checkFreshness(freshGoodCompany(31), false).skip).toBe(false);
    expect(checkFreshness(freshGoodCompany(31), false).reason).toContain('30 days');
  });

  test('re-crawls company never crawled (lastCrawledAt=null)', () => {
    const company = { ...freshGoodCompany(), lastCrawledAt: null };
    expect(checkFreshness(company, false).skip).toBe(false);
    expect(checkFreshness(company, false).reason).toContain('never');
  });

  test('COMPANY_PROFILE_FRESHNESS_MS is exactly 30 days', () => {
    expect(COMPANY_PROFILE_FRESHNESS_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// Profile completeness gates
// ---------------------------------------------------------------------------

describe('profile completeness gates', () => {
  test('re-crawls when no profile exists', () => {
    const company = { ...freshGoodCompany(), profile: null };
    const result = checkFreshness(company, false);
    expect(result.skip).toBe(false);
    expect(result.reason).toContain('no profile');
  });

  test('re-crawls when completionScore is below threshold', () => {
    const company = {
      ...freshGoodCompany(),
      profile: { ...goodProfile, completionScore: COMPLETION_SCORE_THRESHOLD - 1 },
    };
    const result = checkFreshness(company, false);
    expect(result.skip).toBe(false);
    expect(result.reason).toContain('incomplete');
  });

  test('allows skip when completionScore is exactly at threshold', () => {
    const company = {
      ...freshGoodCompany(),
      profile: { ...goodProfile, completionScore: COMPLETION_SCORE_THRESHOLD },
    };
    expect(checkFreshness(company, false).skip).toBe(true);
  });

  test('re-crawls when no emails AND no phones', () => {
    const company = {
      ...freshGoodCompany(),
      profile: { ...goodProfile, emails: [], phones: [] },
    };
    const result = checkFreshness(company, false);
    expect(result.skip).toBe(false);
    expect(result.reason).toContain('no emails and no phones');
  });

  test('allows skip when only emails present (no phones)', () => {
    const company = {
      ...freshGoodCompany(),
      profile: { ...goodProfile, phones: [] },
    };
    expect(checkFreshness(company, false).skip).toBe(true);
  });

  test('allows skip when only phones present (no emails)', () => {
    const company = {
      ...freshGoodCompany(),
      profile: { ...goodProfile, emails: [] },
    };
    expect(checkFreshness(company, false).skip).toBe(true);
  });

  test('re-crawls when no name AND no description', () => {
    const company = {
      ...freshGoodCompany(),
      profile: { ...goodProfile, name: undefined, description: undefined },
    };
    const result = checkFreshness(company, false);
    expect(result.skip).toBe(false);
    expect(result.reason).toContain('no name and no description');
  });

  test('allows skip when only name present (no description)', () => {
    const company = {
      ...freshGoodCompany(),
      profile: { ...goodProfile, description: undefined },
    };
    expect(checkFreshness(company, false).skip).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// End-to-end scenario: "existing company submitted again"
// ---------------------------------------------------------------------------

describe('existing company submitted again scenario', () => {
  test('recently crawled company with complete profile → skip, do not re-crawl', () => {
    const company = {
      crawlStatus: 'COMPLETED',
      lastCrawledAt: daysAgo(5),
      profile: {
        completionScore: 75,
        emails: ['office@hubev.bg'],
        phones: [],
        name: 'Hubev OOD',
        description: 'Bulgarian IT company.',
      },
    };
    const result = checkFreshness(company, false);
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('fresh');
  });

  test('old company (31 days) with complete profile → re-crawl', () => {
    const company = {
      crawlStatus: 'COMPLETED',
      lastCrawledAt: daysAgo(31),
      profile: goodProfile,
    };
    const result = checkFreshness(company, false);
    expect(result.skip).toBe(false);
    expect(result.reason).toContain('30 days');
  });

  test('company with FAILED status → always re-crawl regardless of date', () => {
    const company = {
      crawlStatus: 'FAILED',
      lastCrawledAt: daysAgo(1),
      profile: goodProfile,
    };
    expect(checkFreshness(company, false).skip).toBe(false);
  });

  test('company with empty profile (no contact data) → re-crawl even if recent', () => {
    const company = {
      crawlStatus: 'COMPLETED',
      lastCrawledAt: daysAgo(2),
      profile: {
        completionScore: 60,
        emails: [],
        phones: [],
        name: 'SomeCompany',
        description: null,
      },
    };
    const result = checkFreshness(company, false);
    expect(result.skip).toBe(false);
    expect(result.reason).toContain('no emails and no phones');
  });
});
