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

// Matches common phone formats: +1 (555) 555-5555, +44 20 7946 0958, etc.
// Requires at least one separator (space, dash, dot, parens) to avoid matching raw integers
const PHONE_RE = /(\+?(?:\d{1,3}[\s.\-])?(?:\(?\d{2,4}\)?[\s.\-]){1,3}\d{3,4})/g;

const JUNK_EMAIL_PREFIXES = ['noreply', 'no-reply', 'donotreply', 'git@', 'sender@', 'recipient@',
  'user1@', 'user2@', 'reply@', 'open@', 'u003e'];
const JUNK_EMAIL_DOMAINS = ['example.com', 'example.org', 'example.bg', 'cluster.mongodb.net'];

const FALLBACK_PATHS = ['/about', '/team', '/services', '/contact', '/history'];

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
      // Must have 7–15 digits (international standard)
      if (digits.length < 7 || digits.length > 15) return false;
      // Reject date-like patterns: 2024-01-01, 2026-04-08
      if (/^20\d{2}[-.]?\d{2}[-.]?\d{2}$/.test(p.trim())) return false;
      // Must contain at least one separator to avoid raw integers
      if (!/[\s\-().+]/.test(p)) return false;
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
        pages.push({
          url: request.url,
          text,
          html: '',
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
        pages.push({
          url: request.url,
          text,
          html: '',
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
