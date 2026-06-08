import { CheerioCrawler, PlaywrightCrawler, Configuration } from 'crawlee';
import { MemoryStorage } from '@crawlee/memory-storage';
import * as cheerio from 'cheerio';

export interface CrawledPage {
  url: string;
  text: string;
  html: string;
  emails: string[];
  phones: string[];
}

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Strict phone regex: must start with +/00 (international) or 0 (local)
// This rejects standalone numbers like 226.5000 or coordinates
const PHONE_RE = /(?<!\d)((?:\+\d{1,3}|00\d{1,3})[\s\-.()]*(?: *\d[\s\-.()]*){6,14}|0\d{1,4}[\s\-.](?:\d[\s\-.]?){5,11})(?![\d\-])/g;

const JUNK_EMAIL_PREFIXES = [
  'noreply', 'no-reply', 'donotreply', 'git@', 'sender@', 'recipient@',
  'user1@', 'user2@', 'reply@', 'open@', 'u003e',
];
const JUNK_EMAIL_DOMAINS = [
  'example.com', 'example.org', 'example.bg',
  'cluster.mongodb.net',
  // Placeholder / demo domains frequently found in website HTML
  'website.com', 'yourwebsite.com', 'yourdomain.com', 'domain.com',
  'mysite.com', 'yoursite.com', 'yourcompany.com', 'company.com',
  'email.com', 'mail.com', 'test.com', 'demo.com', 'placeholder.com',
  'sentry.io',    // error tracking addresses, not contact emails
  'sampleemail.com', 'mailserver.com',
];

const FALLBACK_PATHS = ['/about', '/team', '/services', '/contact', '/contact-us', '/contacts', '/kontakti', '/контакти', '/history'];

// Pages where we must save the full HTML for structured extraction (team, services, etc.)
const HTML_SAVE_PATHS = ['/team', '/about', '/services', '/service', '/contact', '/contact-us', '/contacts', '/kontakti', '/history', '/people', '/staff'];

function shouldSaveHtml(url: string): boolean {
  return HTML_SAVE_PATHS.some((p) => url.includes(p));
}

function filterEmails(raw: string[]): string[] {
  return [...new Set(raw.filter((e) => {
    const lower = e.toLowerCase();
    if (JUNK_EMAIL_PREFIXES.some((p) => lower.startsWith(p) || lower.includes(p))) return false;
    if (JUNK_EMAIL_DOMAINS.some((d) => lower.endsWith(`@${d}`))) return false;
    return true;
  }))];
}

function extractEmails(text: string): string[] {
  return filterEmails(text.match(EMAIL_RE) ?? []);
}

// Also extract emails from mailto: href attributes — many sites put emails
// only in <a href="mailto:..."> with no visible text (icon links, etc.)
function extractEmailsFromHtml(html: string): string[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const found: string[] = [];
  $('a[href^="mailto:"], a[href^="MAILTO:"]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    const email = href.replace(/^mailto:/i, '').split('?')[0].trim();
    if (EMAIL_RE.test(email)) found.push(email);
    EMAIL_RE.lastIndex = 0; // reset stateful regex
  });
  return filterEmails(found);
}

// Some sites obfuscate emails by splitting the local-part and domain across
// sibling elements with a <br> or other tag in between, e.g.:
//   <div>contacts@<br /></div><div>volasoftware.com</div>
// The regex matches: localpart@ + any HTML tags/whitespace + domain.tld
const SPLIT_EMAIL_RE = /([a-zA-Z0-9._%+\-]+@)(?:<[^>]*>\s*|\s)+([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;

function extractSplitEmails(html: string): string[] {
  if (!html) return [];
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = SPLIT_EMAIL_RE.exec(html)) !== null) {
    const email = m[1] + m[2];
    EMAIL_RE.lastIndex = 0;
    if (EMAIL_RE.test(email)) found.push(email);
    EMAIL_RE.lastIndex = 0;
  }
  return filterEmails(found);
}

function mergeEmails(text: string, html: string): string[] {
  return [...new Set([
    ...extractEmails(text),
    ...extractEmailsFromHtml(html),
    ...extractSplitEmails(html),
  ])];
}

function extractPhones(text: string): string[] {
  const raw = text.match(PHONE_RE) ?? [];
  const phones = [...new Set(raw
    .map((p) => p.trim())
    .filter((p) => {
      const digits = p.replace(/\D/g, '');
      // Must have 7–15 digits
      if (digits.length < 7 || digits.length > 15) return false;
      // Reject date patterns: dd.mm.yyyy or dd-mm-yyyy
      if (/^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}$/.test(p)) return false;
      // Reject decimal numbers (coordinates, prices): e.g. 226.5000
      if (/^\d+\.\d+$/.test(p)) return false;
      // Reject anything starting with a year (20xx...)
      if (/^(19|20)\d{2}/.test(digits)) return false;
      // Reject IPv4 addresses (e.g. 088.143.253.143)
      if (/^\d+\.\d+\.\d+\.\d+$/.test(p.trim())) return false;
      // Bulgarian numbers only: must start with +359 or 08
      const normalized = p.replace(/[\s\-.()/]/g, '');
      if (!normalized.startsWith('+359') && !normalized.startsWith('08')) return false;
      return true;
    })
  )];
  return phones;
}

function extractNavLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
  const links: string[] = [];
  $('nav a, header a').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const parsed = new URL(href, baseUrl);
      if (!parsed.href.startsWith(baseUrl)) return;
      // Skip language-variant query strings (?lang=xx) — they waste crawl slots
      if (parsed.searchParams.has('lang')) return;
      // Strip fragments; skip if what remains is just the base URL
      parsed.hash = '';
      const clean = parsed.href;
      if (clean === baseUrl || clean === baseUrl + '/') return;
      links.push(clean);
    } catch { /* ignore */ }
  });
  return [...new Set(links)].slice(0, 10);
}

function makeConfig(): Configuration {
  return new Configuration({ storageClient: new MemoryStorage() });
}

// Strip <script>, <style>, and <noscript> before extracting visible text so
// JSON-LD, inline JS, and CSS never bleed into extraction (e.g. location, emails).
function pageText($: cheerio.CheerioAPI): string {
  const $clean = cheerio.load($.html());
  $clean('script, style, noscript').remove();
  return $clean.root().text();
}

async function crawlWithCheerio(baseUrl: string): Promise<CrawledPage[]> {
  const pages: CrawledPage[] = [];
  let homepageHtml = '';

  const firstPass = new CheerioCrawler(
    {
      maxRequestsPerCrawl: 1,
      requestHandlerTimeoutSecs: 20,
      async requestHandler({ $, request, body }) {
        homepageHtml = body.toString();
        const text = pageText($ as unknown as cheerio.CheerioAPI);
        const emails = mergeEmails(text, homepageHtml);
        const phones = extractPhones(text);
        pages.push({
          url: request.url,
          text,
          html: homepageHtml,
          emails,
          phones,
        });
      },
      failedRequestHandler({ request, log }) {
        log.error(`Failed: ${request.url}`);
      },
    },
    makeConfig()
  );

  await firstPass.run([baseUrl]);
  if (pages.length === 0) return pages;

  const $ = cheerio.load(homepageHtml);
  const navLinks = extractNavLinks($, baseUrl);
  const fallbackLinks = FALLBACK_PATHS.map((p) => `${baseUrl}${p}`);
  const urlsToVisit = [...new Set([...navLinks, ...fallbackLinks])].slice(0, 12);

  const secondPass = new CheerioCrawler(
    {
      maxRequestsPerCrawl: urlsToVisit.length,
      requestHandlerTimeoutSecs: 10,
      navigationTimeoutSecs: 10,
      async requestHandler({ $, request }) {
        const text = pageText($ as unknown as cheerio.CheerioAPI);
        const html = $.html();
        const emails = mergeEmails(text, html);
        const phones = extractPhones(text);
        pages.push({
          url: request.url,
          text,
          html: shouldSaveHtml(request.url) ? html : '',
          emails,
          phones,
        });
      },
      failedRequestHandler() { /* silent */ },
    },
    makeConfig()
  );

  await secondPass.run(urlsToVisit);
  return pages;
}

async function crawlWithPlaywright(baseUrl: string): Promise<CrawledPage[]> {
  const pages: CrawledPage[] = [];
  let homepageHtml = '';

  const firstPass = new PlaywrightCrawler(
    {
      maxRequestsPerCrawl: 1,
      requestHandlerTimeoutSecs: 30,
      launchContext: { launchOptions: { headless: true } },
      async requestHandler({ page, request }) {
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        const html = await page.content();
        const text = await page.evaluate(() => document.body.innerText);
        homepageHtml = html;
        const emails = mergeEmails(text, html);
        const phones = extractPhones(text);
        pages.push({
          url: request.url,
          text,
          html,
          emails,
          phones,
        });
      },
      failedRequestHandler({ request, log }) {
        log.error(`Playwright failed: ${request.url}`);
      },
    },
    makeConfig()
  );

  await firstPass.run([baseUrl]);
  if (pages.length === 0 || !homepageHtml) return pages;

  const $ = cheerio.load(homepageHtml);
  const navLinks = extractNavLinks($, baseUrl);
  const fallbackLinks = FALLBACK_PATHS.map((p) => `${baseUrl}${p}`);
  const urlsToVisit = [...new Set([...navLinks, ...fallbackLinks])].slice(0, 12);

  const secondPass = new PlaywrightCrawler(
    {
      maxRequestsPerCrawl: urlsToVisit.length,
      requestHandlerTimeoutSecs: 15,
      navigationTimeoutSecs: 15,
      launchContext: { launchOptions: { headless: true } },
      async requestHandler({ page, request }) {
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        const text = await page.evaluate(() => document.body.innerText);
        const html = await page.content();
        const emails = mergeEmails(text, html);
        const phones = extractPhones(text);
        pages.push({
          url: request.url,
          text,
          html: shouldSaveHtml(request.url) ? html : '',
          emails,
          phones,
        });
      },
      failedRequestHandler() { /* silent */ },
    },
    makeConfig()
  );

  await secondPass.run(urlsToVisit);
  return pages;
}

// ── Bot-protection detection ─────────────────────────────────────────────────
// These patterns match challenge/interstitial pages served instead of real content.
// We detect them AFTER crawling so that both Cheerio and Playwright attempts are covered.
// Detection does NOT attempt bypasses — it flags the company for human review.

const BOT_INDICATORS: Array<[string, RegExp]> = [
  // Cloudflare interstitial
  ['cloudflare-challenge-script',   /challenges\.cloudflare\.com/i],
  ['cloudflare-just-a-moment',      /<title[^>]*>\s*Just a moment/i],
  ['cloudflare-enable-js',          /Enable JavaScript and cookies to continue/i],
  ['cloudflare-checking',           /Checking if the site connection is secure/i],
  ['cloudflare-ray-id',             /Ray ID:\s*[0-9a-f]{16}/i],
  ['cloudflare-cf-wrapper',         /class="cf-wrapper"|cf_chl_opt\s*=/i],
  // DDoS Guard
  ['ddos-guard',                    /ddos-guard\.net/i],
  // Generic human verification
  ['verify-human',                  /Verify you are human/i],
  ['human-verification-title',      /<title[^>]*>\s*(?:Security Check|Bot Check|Human Verification)\s*<\/title>/i],
  // Plain access denied page (must be in title to avoid false positives in body copy)
  ['access-denied-title',           /<title[^>]*>\s*Access Denied\s*<\/title>/i],
  ['403-forbidden-title',           /<title[^>]*>\s*403\s+Forbidden\s*<\/title>/i],
];

export const BOT_CRAWL_NOTE =
  'Site is protected by human verification. Automated crawling could not access the content.';

export function detectBotProtection(pages: CrawledPage[]): { blocked: boolean; indicator: string } {
  for (const page of pages) {
    const content = (page.html || '') + '\n' + (page.text || '');
    for (const [indicator, pattern] of BOT_INDICATORS) {
      if (pattern.test(content)) {
        return { blocked: true, indicator };
      }
    }
  }
  return { blocked: false, indicator: '' };
}

// Pre-flight fetch for sites that return bot-protection content on 4xx responses.
// CheerioCrawler discards 4xx response bodies as failed requests, so we fetch
// the raw response first and check it for bot indicators before running crawlers.
async function fetchForBotCheck(url: string): Promise<CrawledPage | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    if (res.ok) return null;
    const html = await res.text();
    if (!html) return null;
    const $ = cheerio.load(html);
    const text = pageText($);
    const candidate: CrawledPage = { url, text, html, emails: [], phones: [] };
    const { blocked } = detectBotProtection([candidate]);
    return blocked ? candidate : null;
  } catch {
    return null;
  }
}

const CRAWL_TIMEOUT_MS = 60_000;

export async function crawlCompany(baseUrl: string): Promise<CrawledPage[]> {
  const crawl = async (): Promise<CrawledPage[]> => {
    // Pre-flight: capture bot-protection pages served on 4xx responses
    // (CheerioCrawler would silently drop the 403 body — this preserves it)
    const blockedPage = await fetchForBotCheck(baseUrl);
    if (blockedPage) return [blockedPage];

    let pages = await crawlWithCheerio(baseUrl);

    const totalText = pages.reduce((acc, p) => acc + p.text.trim().length, 0);
    if (pages.length === 0 || totalText < 200) {
      console.log(`[crawl] Cheerio got little content for ${baseUrl}, falling back to Playwright`);
      pages = await crawlWithPlaywright(baseUrl);
    }

    return pages;
  };

  const timeout = new Promise<CrawledPage[]>((resolve) =>
    setTimeout(() => {
      console.warn(`[crawl] timeout after ${CRAWL_TIMEOUT_MS / 1000}s for ${baseUrl}`);
      resolve([]);
    }, CRAWL_TIMEOUT_MS)
  );

  return Promise.race([crawl(), timeout]);
}
