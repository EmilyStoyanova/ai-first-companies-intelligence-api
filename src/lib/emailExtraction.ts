import * as cheerio from 'cheerio';

// Must be module-level so callers can reset lastIndex after global usage.
export const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

export const JUNK_EMAIL_PREFIXES = [
  'noreply', 'no-reply', 'donotreply', 'git@', 'sender@', 'recipient@',
  'user1@', 'user2@', 'reply@', 'open@', 'u003e',
];

export const JUNK_EMAIL_DOMAINS = [
  'example.com', 'example.org', 'example.bg',
  'cluster.mongodb.net',
  // Placeholder / demo domains frequently found in website HTML
  'website.com', 'yourwebsite.com', 'yourdomain.com', 'domain.com',
  'mysite.com', 'yoursite.com', 'yourcompany.com', 'company.com',
  'email.com', 'mail.com', 'test.com', 'demo.com', 'placeholder.com',
  'sentry.io',
  'sampleemail.com', 'mailserver.com',
];

// File/media extensions that can appear as the "TLD" of an image filename
// when the regex matches something like logo-footer@2x.png.
const JUNK_TLD_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp', 'tiff', 'tif',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'tar', 'gz',
  'js', 'css', 'html', 'htm', 'xml', 'json', 'txt', 'csv', 'mp4', 'mp3',
]);

// When Cheerio collapses adjacent inline elements without inserting a space,
// the next word on the page merges into the email's TLD:
//   "office@yotovstone.com" + "OUR TEAM" → "office@yotovstone.comOUR"
// EMAIL_RE's unbounded [a-zA-Z]{2,} greedily consumes "comOUR" as one token.
//
// Rule: if the last domain segment mixes lowercase TLD chars with a directly-
// appended uppercase word, clip at the first uppercase letter — provided at
// least 2 lowercase chars precede it (minimum real-TLD length):
//   "comOUR"     → "com"   (upper at 3, ≥2 → clip)
//   "bgContacts" → "bg"    (upper at 2, ≥2 → clip)
//   "comAbout"   → "com"   (upper at 3, ≥2 → clip)
//   "xY"         → no clip (upper at 1,  <2 → safety-net rejection below)
export function truncateAtTldBoundary(e: string): string {
  const atIdx = e.indexOf('@');
  if (atIdx < 0) return e;
  const domain = e.slice(atIdx + 1);
  const lastDot = domain.lastIndexOf('.');
  if (lastDot < 0) return e;
  const tld = domain.slice(lastDot + 1);
  if (/[a-z]/.test(tld) && /[A-Z]/.test(tld)) {
    const upperIdx = tld.search(/[A-Z]/);
    if (upperIdx >= 2) {
      return e.slice(0, atIdx + 1) + domain.slice(0, lastDot + 1) + tld.slice(0, upperIdx);
    }
  }
  return e;
}

export function filterEmails(raw: string[]): string[] {
  return [...new Set(raw.map(truncateAtTldBoundary).filter((e) => {
    const lower = e.toLowerCase();
    if (JUNK_EMAIL_PREFIXES.some((p) => lower.startsWith(p) || lower.includes(p))) return false;
    if (JUNK_EMAIL_DOMAINS.some((d) => lower.endsWith(`@${d}`))) return false;

    // Reject emails where the local part (before @) starts with 4+ consecutive digits.
    // Catches page/reference numbers prepended to emails: "9950user@domain.com".
    const atIdx = e.indexOf('@');
    if (atIdx > 0 && /^\d{4,}/.test(e.slice(0, atIdx))) return false;

    // Reject emails whose TLD (last domain segment after '.') is a media/code file
    // extension — catches image filenames: "logo-footer@2x.png".
    const tldMatch = e.match(/\.([a-zA-Z0-9]+)$/);
    if (tldMatch) {
      const tld = tldMatch[1].toLowerCase();
      if (JUNK_TLD_EXTENSIONS.has(tld)) return false;

      // Safety net: if truncation above couldn't fix a mixed-case TLD (upper position
      // was < 2, so the remaining TLD would be too short to be valid), reject entirely.
      if (/[a-z]/.test(tldMatch[1]) && /[A-Z]/.test(tldMatch[1])) return false;
    }

    return true;
  }))];
}

// Extract emails from visible page text (already entity-decoded by Cheerio).
export function extractEmails(text: string): string[] {
  EMAIL_RE.lastIndex = 0;
  return filterEmails(text.match(EMAIL_RE) ?? []);
}

// Extract emails from HTML markup — covers mailto: links and data-* attributes
// used by contact form plugins and anti-spam setups.
export function extractEmailsFromHtml(html: string): string[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const found: string[] = [];

  // mailto: href — the most common way to link a contact email
  $('a[href^="mailto:"], a[href^="MAILTO:"]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    const email = href.replace(/^mailto:/i, '').split('?')[0].trim();
    EMAIL_RE.lastIndex = 0;
    if (EMAIL_RE.test(email)) found.push(email);
    EMAIL_RE.lastIndex = 0;
  });

  // data-email / data-mail attributes — WordPress and custom anti-spam plugins
  $('[data-email], [data-mail]').each((_i, el) => {
    const v = ($(el).attr('data-email') ?? $(el).attr('data-mail') ?? '').trim();
    EMAIL_RE.lastIndex = 0;
    if (v && EMAIL_RE.test(v)) found.push(v);
    EMAIL_RE.lastIndex = 0;
  });

  return filterEmails(found);
}

// Some sites split the local-part and domain across HTML tags:
//   contacts@<br />company.bg   or   info@<!-- --><span>example.bg</span>
const SPLIT_EMAIL_RE = /([a-zA-Z0-9._%+\-]+@)(?:<[^>]*>\s*|\s)+([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;

export function extractSplitEmails(html: string): string[] {
  if (!html) return [];
  const found: string[] = [];
  SPLIT_EMAIL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPLIT_EMAIL_RE.exec(html)) !== null) {
    const email = m[1] + m[2];
    EMAIL_RE.lastIndex = 0;
    if (EMAIL_RE.test(email)) found.push(email);
    EMAIL_RE.lastIndex = 0;
  }
  return filterEmails(found);
}

// Deobfuscate anti-spam tricks before running the standard email regex.
// Handles: [at], (at), {at}, [dot], (dot), space-separated @ and domain dots.
// Only applied to decoded text — HTML entities are already resolved by Cheerio.
export function extractObfuscatedEmails(text: string): string[] {
  let s = text;

  // Bracket/paren/brace forms: [at] (at) {at} → @
  s = s.replace(/\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\}/gi, '@');

  // Bracket/paren/brace forms: [dot] (dot) {dot} → .
  s = s.replace(/\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\}/gi, '.');

  // Spaces around @: "name @ domain" → "name@domain"
  // Requires a valid email character on both sides to reduce false positives.
  s = s.replace(/([a-zA-Z0-9._%+\-])\s+@\s+([a-zA-Z0-9])/g, '$1@$2');

  // Spaced dots within email domain context: "name@domain . tld" → "name@domain.tld"
  // Anchored to a segment that already contains @ to avoid matching sentence dots.
  // Applied twice to handle two-level domains: "sub . domain . bg"
  const domainDot = /(@[a-zA-Z0-9\-]+(?:\.[a-zA-Z0-9\-]+)*)\s+\.\s+([a-zA-Z]{2,})/g;
  s = s.replace(domainDot, '$1.$2');
  domainDot.lastIndex = 0;
  s = s.replace(domainDot, '$1.$2');

  EMAIL_RE.lastIndex = 0;
  return filterEmails(s.match(EMAIL_RE) ?? []);
}

// ── Cloudflare email protection ────────────────────────────────────────────────
// Cloudflare encodes contact emails with XOR to prevent scraping.
// The first hex byte pair is the key; remaining pairs XOR'd with the key give ASCII.

function decodeCfEmail(encoded: string): string {
  try {
    if (!encoded || encoded.length < 4 || encoded.length % 2 !== 0) return '';
    const key = parseInt(encoded.substring(0, 2), 16);
    let result = '';
    for (let i = 2; i < encoded.length; i += 2) {
      result += String.fromCharCode(parseInt(encoded.substring(i, i + 2), 16) ^ key);
    }
    return result;
  } catch {
    return '';
  }
}

export function extractCloudflareEmails(html: string): string[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const found: string[] = [];

  // Form 1: <a href="/cdn-cgi/l/email-protection#HEXENCODED">
  $('a[href*="email-protection#"]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    const hashPart = href.split('#')[1];
    if (!hashPart) return;
    const email = decodeCfEmail(hashPart);
    EMAIL_RE.lastIndex = 0;
    if (email && EMAIL_RE.test(email)) found.push(email);
    EMAIL_RE.lastIndex = 0;
  });

  // Form 2: <span class="__cf_email__" data-cfemail="HEXENCODED">
  $('[data-cfemail]').each((_i, el) => {
    const encoded = ($(el).attr('data-cfemail') ?? '').trim();
    const email = decodeCfEmail(encoded);
    EMAIL_RE.lastIndex = 0;
    if (email && EMAIL_RE.test(email)) found.push(email);
    EMAIL_RE.lastIndex = 0;
  });

  return filterEmails(found);
}

// ── Extended attribute scanning ────────────────────────────────────────────────
// Some sites store contact emails in DOM attributes rather than visible text.

export function extractEmailsFromAttributes(html: string): string[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const found: string[] = [];

  const tryMatch = (val: string | undefined) => {
    if (!val) return;
    EMAIL_RE.lastIndex = 0;
    const matches = val.match(EMAIL_RE) ?? [];
    EMAIL_RE.lastIndex = 0;
    found.push(...matches);
  };

  // Image alt / title — contact icons sometimes carry the email as alt text
  $('img').each((_i, el) => {
    tryMatch($(el).attr('alt'));
    tryMatch($(el).attr('title'));
  });

  // aria-label — accessibility labels on icon-only email links
  $('[aria-label]').each((_i, el) => tryMatch($(el).attr('aria-label')));

  // title tooltip attribute on any element
  $('[title]').each((_i, el) => tryMatch($(el).attr('title')));

  // <meta content="..."> — og:email, author, contact-related meta
  $('meta[content]').each((_i, el) => tryMatch($(el).attr('content')));

  // <input value="..."> — pre-filled contact fields
  $('input[value]').each((_i, el) => tryMatch($(el).attr('value')));

  // data-contact / data-value — custom CMS and form attributes
  $('[data-contact]').each((_i, el) => tryMatch($(el).attr('data-contact')));
  $('[data-value]').each((_i, el)   => tryMatch($(el).attr('data-value')));

  return filterEmails(found);
}

// ── JavaScript string concatenation ───────────────────────────────────────────
// Detects patterns like:
//   'user' + '@' + 'domain.bg'
//   "user"+"@"+"domain.bg"
//   'user' + '&#64;' + 'domain.bg'
// The result is only accepted when it passes strict email validation.

export function extractEmailsFromJsConcat(html: string): string[] {
  if (!html) return [];
  const found: string[] = [];
  // Quotes can be mixed (', "), spaces around + are optional
  const JS_CONCAT_RE = /['"]([a-zA-Z0-9._%+\-]+)['"]\s*\+\s*['"](?:@|&#64;)['"]\s*\+\s*['"]([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})['"]/g;
  JS_CONCAT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JS_CONCAT_RE.exec(html)) !== null) {
    const email = `${m[1]}@${m[2]}`;
    EMAIL_RE.lastIndex = 0;
    if (EMAIL_RE.test(email)) found.push(email);
    EMAIL_RE.lastIndex = 0;
  }
  return filterEmails(found);
}

// ── Inline iframe content ──────────────────────────────────────────────────────
// Only processes <iframe srcdoc="..."> — inline HTML requiring no network request.
// src-based iframes at the same origin are naturally visited by the crawler.

export function extractEmailsFromIframeSrcdoc(html: string): string[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const found: string[] = [];
  $('iframe[srcdoc]').each((_i, el) => {
    const srcdoc = $(el).attr('srcdoc') ?? '';
    if (!srcdoc) return;
    const $inner = cheerio.load(srcdoc);
    const innerText = $inner.root().text();
    found.push(...extractEmails(innerText));
    found.push(...extractEmailsFromHtml(srcdoc));
    found.push(...extractSplitEmails(srcdoc));
    found.push(...extractCloudflareEmails(srcdoc));
    found.push(...extractEmailsFromAttributes(srcdoc));
  });
  return filterEmails([...new Set(found)]);
}

// ── Combine all strategies ────────────────────────────────────────────────────

export function mergeEmails(text: string, html: string): string[] {
  // When the caller doesn't supply rendered text (or text extraction failed),
  // derive it from the HTML as a safety net. In normal crawler flows this path
  // is never taken since text always comes from Cheerio/Playwright.
  const effectiveText = text || (() => {
    if (!html) return '';
    try {
      const $s = cheerio.load(html);
      $s('script, style, noscript').remove();
      return $s.root().text();
    } catch { return ''; }
  })();

  return [...new Set([
    ...extractEmails(effectiveText),
    ...extractEmailsFromHtml(html),
    ...extractSplitEmails(html),
    ...extractObfuscatedEmails(effectiveText),
    ...extractCloudflareEmails(html),
    ...extractEmailsFromAttributes(html),
    ...extractEmailsFromJsConcat(html),
    ...extractEmailsFromIframeSrcdoc(html),
  ])];
}
