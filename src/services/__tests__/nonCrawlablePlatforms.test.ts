import { isNonCrawlablePlatform, getCrawlability, Crawlability } from '../nonCrawlablePlatforms';

// ── isNonCrawlablePlatform ──────────────────────────────────────────────────

describe('isNonCrawlablePlatform', () => {
  // Test A — bare domain
  test('A: facebook.com is non-crawlable', () => {
    expect(isNonCrawlablePlatform('facebook.com')).toBe(true);
  });

  // Test C — URL with path
  test('C: youtube.com/@company is non-crawlable', () => {
    expect(isNonCrawlablePlatform('https://youtube.com/@company')).toBe(true);
  });

  // Test D — regular company domain
  test('D: company.com is crawlable', () => {
    expect(isNonCrawlablePlatform('company.com')).toBe(false);
  });

  // Core social platforms
  test('linkedin.com is non-crawlable', () => {
    expect(isNonCrawlablePlatform('linkedin.com')).toBe(true);
  });

  test('instagram.com is non-crawlable', () => {
    expect(isNonCrawlablePlatform('instagram.com')).toBe(true);
  });

  test('twitter.com is non-crawlable', () => {
    expect(isNonCrawlablePlatform('twitter.com')).toBe(true);
  });

  test('x.com is non-crawlable', () => {
    expect(isNonCrawlablePlatform('x.com')).toBe(true);
  });

  test('tiktok.com is non-crawlable', () => {
    expect(isNonCrawlablePlatform('tiktok.com')).toBe(true);
  });

  test('threads.net is non-crawlable', () => {
    expect(isNonCrawlablePlatform('threads.net')).toBe(true);
  });

  test('pinterest.com is non-crawlable', () => {
    expect(isNonCrawlablePlatform('pinterest.com')).toBe(true);
  });

  test('snapchat.com is non-crawlable', () => {
    expect(isNonCrawlablePlatform('snapchat.com')).toBe(true);
  });

  // Messaging platforms
  test('telegram.me is non-crawlable', () => {
    expect(isNonCrawlablePlatform('telegram.me')).toBe(true);
  });

  test('t.me is non-crawlable', () => {
    expect(isNonCrawlablePlatform('t.me')).toBe(true);
  });

  test('wa.me is non-crawlable', () => {
    expect(isNonCrawlablePlatform('wa.me')).toBe(true);
  });

  test('whatsapp.com is non-crawlable', () => {
    expect(isNonCrawlablePlatform('whatsapp.com')).toBe(true);
  });

  // Reference platforms
  test('wikipedia.org is non-crawlable', () => {
    expect(isNonCrawlablePlatform('wikipedia.org')).toBe(true);
  });

  test('wikidata.org is non-crawlable', () => {
    expect(isNonCrawlablePlatform('wikidata.org')).toBe(true);
  });

  // Google properties
  test('google.com is non-crawlable', () => {
    expect(isNonCrawlablePlatform('google.com')).toBe(true);
  });

  test('goo.gl is non-crawlable', () => {
    expect(isNonCrawlablePlatform('goo.gl')).toBe(true);
  });

  // ── Subdomain variants ────────────────────────────────────────────────────

  test('www.facebook.com is detected', () => {
    expect(isNonCrawlablePlatform('www.facebook.com')).toBe(true);
  });

  test('m.facebook.com is detected', () => {
    expect(isNonCrawlablePlatform('m.facebook.com')).toBe(true);
  });

  test('mobile.facebook.com is detected', () => {
    expect(isNonCrawlablePlatform('mobile.facebook.com')).toBe(true);
  });

  test('maps.google.com is detected (functional subdomain)', () => {
    expect(isNonCrawlablePlatform('maps.google.com')).toBe(true);
  });

  test('en.wikipedia.org is detected (localized subdomain)', () => {
    expect(isNonCrawlablePlatform('en.wikipedia.org')).toBe(true);
  });

  test('bg.linkedin.com is detected (country subdomain)', () => {
    expect(isNonCrawlablePlatform('bg.linkedin.com')).toBe(true);
  });

  test('fb.com short domain is detected', () => {
    expect(isNonCrawlablePlatform('fb.com')).toBe(true);
  });

  // ── Full URLs ─────────────────────────────────────────────────────────────

  test('https://www.linkedin.com/company/openai is detected', () => {
    expect(isNonCrawlablePlatform('https://www.linkedin.com/company/openai')).toBe(true);
  });

  test('https://facebook.com/companypage is detected', () => {
    expect(isNonCrawlablePlatform('https://facebook.com/companypage')).toBe(true);
  });

  // ── Valid company domains that must NOT be flagged ────────────────────────

  test('acme-company.com is crawlable', () => {
    expect(isNonCrawlablePlatform('acme-company.com')).toBe(false);
  });

  test('dg-slance.bg is crawlable', () => {
    expect(isNonCrawlablePlatform('dg-slance.bg')).toBe(false);
  });

  test('hubev.bg/contact is crawlable', () => {
    expect(isNonCrawlablePlatform('https://hubev.bg/contact')).toBe(false);
  });

  test('company-with-book-in-name.com is crawlable', () => {
    expect(isNonCrawlablePlatform('company-with-book-in-name.com')).toBe(false);
  });

  test('empty string returns false', () => {
    expect(isNonCrawlablePlatform('')).toBe(false);
  });
});

// ── getCrawlability ──────────────────────────────────────────────────────────

describe('getCrawlability', () => {
  // Test B — social profile URL
  test('B: linkedin.com/company/openai is SOCIAL_PROFILE', () => {
    expect(getCrawlability('https://linkedin.com/company/openai')).toBe(Crawlability.SOCIAL_PROFILE);
  });

  test('facebook.com bare domain is NON_CRAWLABLE_PLATFORM', () => {
    expect(getCrawlability('facebook.com')).toBe(Crawlability.NON_CRAWLABLE_PLATFORM);
  });

  test('company.com is CRAWLABLE', () => {
    expect(getCrawlability('company.com')).toBe(Crawlability.CRAWLABLE);
  });

  test('youtube.com/@company has path → SOCIAL_PROFILE', () => {
    expect(getCrawlability('https://youtube.com/@company')).toBe(Crawlability.SOCIAL_PROFILE);
  });

  test('youtube.com bare domain is NON_CRAWLABLE_PLATFORM', () => {
    expect(getCrawlability('youtube.com')).toBe(Crawlability.NON_CRAWLABLE_PLATFORM);
  });

  test('facebook.com/acme-corp is SOCIAL_PROFILE', () => {
    expect(getCrawlability('https://facebook.com/acme-corp')).toBe(Crawlability.SOCIAL_PROFILE);
  });

  test('wikipedia.org bare domain is NON_CRAWLABLE_PLATFORM', () => {
    expect(getCrawlability('wikipedia.org')).toBe(Crawlability.NON_CRAWLABLE_PLATFORM);
  });

  test('en.wikipedia.org/wiki/Acme is SOCIAL_PROFILE', () => {
    expect(getCrawlability('https://en.wikipedia.org/wiki/Acme')).toBe(Crawlability.SOCIAL_PROFILE);
  });

  test('empty string is UNKNOWN', () => {
    expect(getCrawlability('')).toBe(Crawlability.UNKNOWN);
  });
});

// ── Queue protection scenario (E) ────────────────────────────────────────────

describe('queue protection scenario', () => {
  // Test E — isNonCrawlablePlatform used as queue gate
  test('E: facebook.com must be rejected by queue gate', () => {
    const domain = 'facebook.com';
    const shouldEnqueue = !isNonCrawlablePlatform(domain);
    expect(shouldEnqueue).toBe(false);
  });

  test('company.com must pass queue gate', () => {
    const domain = 'company.com';
    const shouldEnqueue = !isNonCrawlablePlatform(domain);
    expect(shouldEnqueue).toBe(true);
  });
});

// ── Candidate scenario (G) ───────────────────────────────────────────────────

describe('candidate scenario', () => {
  // Test G — company website crawled, social link stored only
  test('G: company.com passes, facebook.com/company is identified as social', () => {
    const website = 'company.com';
    const socialUrl = 'https://facebook.com/company';

    expect(isNonCrawlablePlatform(website)).toBe(false);       // → crawl
    expect(isNonCrawlablePlatform(socialUrl)).toBe(true);      // → skip crawl
    expect(getCrawlability(socialUrl)).toBe(Crawlability.SOCIAL_PROFILE); // → store as social link
  });
});
