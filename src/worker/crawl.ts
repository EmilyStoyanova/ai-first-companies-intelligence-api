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

const FALLBACK_PATHS = ['/about', '/team', '/services', '/contact', '/history'];

// Pages where we must save the full HTML for structured extraction (team, services, etc.)
const HTML_SAVE_PATHS = ['/team', '/about', '/services', '/service', '/contact', '/history', '/people', '/staff'];

function shouldSaveHtml(url: string): boolean {
  return HTML_SAVE_PATHS.some((p) => url.includes(p));
}

function extractEmails(text: string): string[] {
  const raw = text.match(EMAIL_RE) ?? [];
  return [...new Set(raw.filter((e) => {
    const lower = e.toLowerCase();
    if (JUNK_EMAIL_PREFIXES.some((p) => lower.startsWith(p) || lower.includes(p))) return false;
    if (JUNK_EMAIL_DOMAINS.some((d) => lower.endsWith(`@${d}`))) return false;
    return true;
  }))];
}

function extractPhones(text: string): string[] {
  const raw = text.match(PHONE_RE) ?? [];
  return [...new Set(raw
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
      return true;
    })
  )];
}

function extractNavLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
  const links: string[] = [];
  $('nav a, header a').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const abs = new URL(href, baseUrl).href;
      if (abs.startsWith(baseUrl)) links.push(abs);
    } catch { /* ignore */ }
  });
  return [...new Set(links)].slice(0, 10);
}

function makeConfig(): Configuration {
  return new Configuration({ storageClient: new MemoryStorage() });
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
        const text = $.text();
        pages.push({
          url: request.url,
          text,
          html: homepageHtml,
          emails: extractEmails(text),
          phones: extractPhones(text),
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
      requestHandlerTimeoutSecs: 20,
      async requestHandler({ $, request }) {
        const text = $.text();
        // Save full HTML for pages that are needed for structured extraction
        const html = shouldSaveHtml(request.url) ? $.html() : '';
        pages.push({
          url: request.url,
          text,
          html,
          emails: extractEmails(text),
          phones: extractPhones(text),
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
        pages.push({
          url: request.url,
          text,
          html,
          emails: extractEmails(text),
          phones: extractPhones(text),
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
      requestHandlerTimeoutSecs: 30,
      launchContext: { launchOptions: { headless: true } },
      async requestHandler({ page, request }) {
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        const text = await page.evaluate(() => document.body.innerText);
        // Save full HTML for important pages
        const html = shouldSaveHtml(request.url) ? await page.content() : '';
        pages.push({
          url: request.url,
          text,
          html,
          emails: extractEmails(text),
          phones: extractPhones(text),
        });
      },
      failedRequestHandler() { /* silent */ },
    },
    makeConfig()
  );

  await secondPass.run(urlsToVisit);
  return pages;
}

export async function crawlCompany(baseUrl: string): Promise<CrawledPage[]> {
  let pages = await crawlWithCheerio(baseUrl);

  const totalText = pages.reduce((acc, p) => acc + p.text.trim().length, 0);
  if (pages.length === 0 || totalText < 200) {
    console.log(`[crawl] Cheerio got little content for ${baseUrl}, falling back to Playwright`);
    pages = await crawlWithPlaywright(baseUrl);
  }

  return pages;
}
