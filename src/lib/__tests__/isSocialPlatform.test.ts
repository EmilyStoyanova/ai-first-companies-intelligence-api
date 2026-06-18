import { isSocialPlatform } from '../isSocialPlatform';

describe('isSocialPlatform', () => {
  // ── Full URLs ───────────────────────────────────────────────────────────────

  test('A — facebook.com/company is a social profile', () => {
    expect(isSocialPlatform('https://facebook.com/company')).toBe(true);
  });

  test('B — linkedin.com/company/openai is a social profile', () => {
    expect(isSocialPlatform('https://www.linkedin.com/company/openai')).toBe(true);
  });

  test('C — instagram.com/company is a social profile', () => {
    expect(isSocialPlatform('https://instagram.com/company')).toBe(true);
  });

  test('D — company.com is a valid company domain', () => {
    expect(isSocialPlatform('https://company.com')).toBe(false);
  });

  test('youtube.com/@channel is a social profile', () => {
    expect(isSocialPlatform('https://youtube.com/@channel')).toBe(true);
  });

  test('youtu.be/video is a social profile', () => {
    expect(isSocialPlatform('https://youtu.be/video')).toBe(true);
  });

  test('x.com/handle is a social profile', () => {
    expect(isSocialPlatform('https://x.com/handle')).toBe(true);
  });

  test('twitter.com/handle is a social profile', () => {
    expect(isSocialPlatform('https://twitter.com/handle')).toBe(true);
  });

  test('threads.net/@user is a social profile', () => {
    expect(isSocialPlatform('https://threads.net/@user')).toBe(true);
  });

  test('tiktok.com/@user is a social profile', () => {
    expect(isSocialPlatform('https://tiktok.com/@user')).toBe(true);
  });

  test('pinterest.com/board is a social profile', () => {
    expect(isSocialPlatform('https://pinterest.com/board')).toBe(true);
  });

  test('snapchat.com/add/user is a social profile', () => {
    expect(isSocialPlatform('https://snapchat.com/add/user')).toBe(true);
  });

  // ── Subdomain variants ──────────────────────────────────────────────────────

  test('www.facebook.com is detected', () => {
    expect(isSocialPlatform('https://www.facebook.com/page')).toBe(true);
  });

  test('m.facebook.com is detected', () => {
    expect(isSocialPlatform('https://m.facebook.com/page')).toBe(true);
  });

  test('mobile.facebook.com is detected', () => {
    expect(isSocialPlatform('https://mobile.facebook.com/page')).toBe(true);
  });

  test('fb.com short URL is detected', () => {
    expect(isSocialPlatform('https://fb.com/page')).toBe(true);
  });

  // ── Bare domains ────────────────────────────────────────────────────────────

  test('bare domain facebook.com is detected', () => {
    expect(isSocialPlatform('facebook.com')).toBe(true);
  });

  test('bare domain linkedin.com is detected', () => {
    expect(isSocialPlatform('linkedin.com')).toBe(true);
  });

  // ── Valid domains that should NOT be flagged ────────────────────────────────

  test('dg-slance.bg is not a social platform', () => {
    expect(isSocialPlatform('https://dg-slance.bg')).toBe(false);
  });

  test('hubev.bg is not a social platform', () => {
    expect(isSocialPlatform('https://hubev.bg/contact')).toBe(false);
  });

  test('company-with-book-in-name.com is not a social platform', () => {
    expect(isSocialPlatform('https://company-with-book-in-name.com')).toBe(false);
  });

  test('empty string returns false', () => {
    expect(isSocialPlatform('')).toBe(false);
  });
});
