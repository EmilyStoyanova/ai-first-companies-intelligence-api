import { normalizeRawProfileUrl, normalizeDomain } from '../normalizeRawProfileUrl';

// ---------------------------------------------------------------------------
// normalizeRawProfileUrl
// ---------------------------------------------------------------------------

describe('normalizeRawProfileUrl', () => {
  // ── Trailing slash ────────────────────────────────────────────────────────

  test('/contact/ and /contact produce the same key', () => {
    expect(normalizeRawProfileUrl('https://hubev.bg/contact/'))
      .toBe(normalizeRawProfileUrl('https://hubev.bg/contact'));
  });

  test('/kontakti/ and /kontakti produce the same key', () => {
    expect(normalizeRawProfileUrl('https://hubev.bg/kontakti/'))
      .toBe(normalizeRawProfileUrl('https://hubev.bg/kontakti'));
  });

  test('root URL trailing slash is preserved (home page)', () => {
    // https://hubev.bg/ → https://hubev.bg/  (single slash = root, not stripped)
    const result = normalizeRawProfileUrl('https://hubev.bg/');
    expect(result).toBe('https://hubev.bg/');
  });

  // ── www removal ───────────────────────────────────────────────────────────

  test('www.hubev.bg and hubev.bg produce the same key', () => {
    expect(normalizeRawProfileUrl('https://www.hubev.bg/contact'))
      .toBe(normalizeRawProfileUrl('https://hubev.bg/contact'));
  });

  // ── Protocol normalisation ────────────────────────────────────────────────

  test('http:// is normalised to https://', () => {
    expect(normalizeRawProfileUrl('http://hubev.bg/contact'))
      .toBe('https://hubev.bg/contact');
  });

  // ── Default port removal ──────────────────────────────────────────────────

  test('port 443 is stripped from https URL', () => {
    expect(normalizeRawProfileUrl('https://hubev.bg:443/contact'))
      .toBe('https://hubev.bg/contact');
  });

  test('port 80 is stripped from https URL', () => {
    expect(normalizeRawProfileUrl('https://hubev.bg:80/contact'))
      .toBe('https://hubev.bg/contact');
  });

  // ── Tracking parameter removal ────────────────────────────────────────────

  test('utm_source param is stripped', () => {
    expect(normalizeRawProfileUrl('https://hubev.bg/contact?utm_source=google'))
      .toBe('https://hubev.bg/contact');
  });

  test('multiple tracking params are all stripped', () => {
    expect(
      normalizeRawProfileUrl(
        'https://hubev.bg/contact?utm_source=google&utm_medium=email&fbclid=abc123',
      ),
    ).toBe('https://hubev.bg/contact');
  });

  test('non-tracking query params are preserved', () => {
    const result = normalizeRawProfileUrl('https://hubev.bg/search?q=oraganizacii');
    expect(result).toBe('https://hubev.bg/search?q=oraganizacii');
  });

  // ── Fragment removal ──────────────────────────────────────────────────────

  test('fragment is stripped', () => {
    expect(normalizeRawProfileUrl('https://hubev.bg/contact#form'))
      .toBe('https://hubev.bg/contact');
  });

  // ── Case normalisation ────────────────────────────────────────────────────

  test('hostname is lowercased', () => {
    expect(normalizeRawProfileUrl('https://HubeV.BG/contact'))
      .toBe('https://hubev.bg/contact');
  });

  // ── Dedup scenarios ───────────────────────────────────────────────────────

  test('same page, different spellings → single dedup key', () => {
    const variants = [
      'https://hubev.bg/contact',
      'https://hubev.bg/contact/',
      'https://www.hubev.bg/contact',
      'https://www.hubev.bg/contact/',
      'http://hubev.bg/contact',
    ];
    const keys = variants.map(normalizeRawProfileUrl);
    const unique = new Set(keys);
    expect(unique.size).toBe(1);
  });

  test('different pages → different dedup keys', () => {
    const a = normalizeRawProfileUrl('https://hubev.bg/contact');
    const b = normalizeRawProfileUrl('https://hubev.bg/about');
    expect(a).not.toBe(b);
  });

  test('same path on different domains → different keys', () => {
    const a = normalizeRawProfileUrl('https://hubev.bg/contact');
    const b = normalizeRawProfileUrl('https://acme.bg/contact');
    expect(a).not.toBe(b);
  });

  // ── Graceful fallback ─────────────────────────────────────────────────────

  test('invalid URL falls back to trimmed lowercase', () => {
    const result = normalizeRawProfileUrl('not-a-url');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// normalizeDomain
// ---------------------------------------------------------------------------

describe('normalizeDomain', () => {
  test('strips https:// and www.', () => {
    expect(normalizeDomain('https://www.hubev.bg')).toBe('hubev.bg');
  });

  test('strips http:// only', () => {
    expect(normalizeDomain('http://hubev.bg')).toBe('hubev.bg');
  });

  test('strips path', () => {
    expect(normalizeDomain('https://hubev.bg/contact')).toBe('hubev.bg');
  });

  test('bare domain works without protocol', () => {
    expect(normalizeDomain('hubev.bg')).toBe('hubev.bg');
  });

  test('bare domain with www works', () => {
    expect(normalizeDomain('www.hubev.bg')).toBe('hubev.bg');
  });

  test('lowercases the hostname', () => {
    expect(normalizeDomain('HUBEV.BG')).toBe('hubev.bg');
  });
});
