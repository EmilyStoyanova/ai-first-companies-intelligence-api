import * as cheerio from 'cheerio';
import { CrawledPage } from '../worker/crawl';
import { normalizePhone, canonicalizePhone } from '../lib/phoneExtraction';

export interface TeamMember {
  name?: string;
  position?: string;
  email?: string;
  linkedin?: string;
}

export interface ExtractedProfile {
  name?: string;
  description?: string;
  location?: string;
  emails: string[];
  phones: string[];
  services: string[];
  team: TeamMember[];
  history?: string;
  socialLinks: Record<string, string>;
  completionScore: number;
}

const SOCIAL_DOMAINS: Record<string, string> = {
  'linkedin.com': 'linkedin',
  'facebook.com': 'facebook',
  'twitter.com':  'twitter',
  'x.com':        'twitter',
  'instagram.com': 'instagram',
  'youtube.com':  'youtube',
};

// ── Social URL normalizer ─────────────────────────────────────────────────────
// Returns a { platform, url } pair when rawUrl is a valid company-level social
// presence, or null when the URL is a personal profile, post, video, etc.
// Exported for use in social search enrichment.

export function normalizeSocialUrl(rawUrl: string): { platform: string; url: string } | null {
  if (!rawUrl.startsWith('http')) return null;
  let u: URL;
  try { u = new URL(rawUrl); } catch { return null; }

  const hostname = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const platform = SOCIAL_DOMAINS[hostname];
  if (!platform) return null;

  const segments = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);

  switch (platform) {
    case 'linkedin': {
      // Accept only /company/<slug> — reject /in/ (personal), /jobs/, /posts/ etc.
      if (segments[0] !== 'company' || !segments[1]) return null;
      return {
        platform: 'linkedin',
        url: `https://www.linkedin.com/company/${segments[1].toLowerCase()}`,
      };
    }

    case 'facebook': {
      if (segments.length === 0) return null;
      const first = segments[0].toLowerCase();
      const REJECT_FB = new Set([
        'events', 'groups', 'marketplace', 'watch', 'gaming', 'video', 'videos',
        'live', 'ads', 'business', 'login', 'logout', 'help', 'policies', 'privacy',
        'sharer', 'share', 'dialog',
      ]);
      if (REJECT_FB.has(first)) return null;

      if (first === 'profile.php') {
        const id = u.searchParams.get('id');
        if (!id) return null;
        return { platform: 'facebook', url: `https://www.facebook.com/profile.php?id=${id}` };
      }
      if (first === 'pages') {
        if (segments.length < 3) return null;
        return { platform: 'facebook', url: `https://www.facebook.com/pages/${segments[1]}/${segments[2]}` };
      }
      // Reject purely numeric slugs (unresolved personal profile IDs)
      if (/^\d+$/.test(first)) return null;
      // Normalise to the first path segment — strips /posts/123, /about, etc.
      return { platform: 'facebook', url: `https://www.facebook.com/${first}` };
    }

    case 'instagram': {
      if (segments.length === 0) return null;
      const REJECT_IG = new Set(['p', 'stories', 'reel', 'reels', 'tv', 'explore', 'accounts', 'about', 'directory']);
      if (REJECT_IG.has(segments[0].toLowerCase())) return null;
      return { platform: 'instagram', url: `https://www.instagram.com/${segments[0]}` };
    }

    case 'youtube': {
      if (segments.length === 0) return null;
      const first = segments[0];
      const firstLower = first.toLowerCase();
      const REJECT_YT = new Set(['watch', 'results', 'feed', 'playlist', 'shorts', 'trending']);
      if (REJECT_YT.has(firstLower)) return null;
      if (first.startsWith('@')) {
        return { platform: 'youtube', url: `https://www.youtube.com/${first}` };
      }
      if (['channel', 'c', 'user'].includes(firstLower) && segments[1]) {
        return { platform: 'youtube', url: `https://www.youtube.com/${first}/${segments[1]}` };
      }
      return null;
    }

    case 'twitter': {
      if (segments.length === 0) return null;
      const REJECT_TW = new Set([
        'i', 'hashtag', 'search', 'explore', 'notifications', 'messages',
        'settings', 'home', 'login', 'intent', 'share',
      ]);
      if (REJECT_TW.has(segments[0].toLowerCase())) return null;
      if (!/^[a-zA-Z0-9_]{1,50}$/.test(segments[0])) return null;
      return { platform: 'twitter', url: `https://twitter.com/${segments[0]}` };
    }

    default:
      return null;
  }
}

// ── Social links ──────────────────────────────────────────────────────────────

function extractSocialLinks(pages: CrawledPage[]): Record<string, string> {
  const links: Record<string, string> = {};

  const add = (rawUrl: string) => {
    const result = normalizeSocialUrl(rawUrl);
    if (result && !links[result.platform]) links[result.platform] = result.url;
  };

  for (const page of pages) {
    if (!page.html) continue;
    const $ = cheerio.load(page.html);

    // Primary: all anchor hrefs — covers footer social icons, contact links, etc.
    $('a[href]').each((_i, el) => add($(el).attr('href') ?? ''));

    // <link> tags: some sites declare social profiles via <link rel="me">
    $('link[href]').each((_i, el) => add($(el).attr('href') ?? ''));

    // Meta tags used by social platforms and CMS plugins
    add($('meta[property="og:url"]').attr('content') ?? '');
    add($('meta[property="article:publisher"]').attr('content') ?? '');
  }

  return links;
}

// ── Company name ──────────────────────────────────────────────────────────────

// Titles that are bot-protection or server error pages, never real company names.
const BLOCKED_TITLE_RE = /^(just a moment|access denied|403 forbidden|security check|bot check|human verification|please wait|ddos protection|attention required)\s*\.{0,3}$/i;

// Exact (normalised) strings that are generic authentication or navigation page
// titles, not company names.  Normalisation: lowercase, trim, collapse
// hyphens/underscores/spaces to a single space before lookup.
const GENERIC_AUTH_NAME_SET = new Set([
  'login', 'log in', 'sign in', 'signin', 'sign-in',
  'вход', 'влизане',
  'portal', 'customer portal', 'client portal', 'dealer portal', 'user portal',
  'customer area', 'client area', 'member area', 'dealer area',
  'my account', 'account',
  'welcome',
  'dashboard',
  'forgot password', 'reset password', 'forgot your password',
  'authentication', 'auth',
  'secure login', 'user login', 'admin login', 'admin',
  'access', 'access denied',
  // Generic home / landing page labels (Latin)
  'home', 'home page', 'homepage',
  'index', 'index page',
  'main', 'main page',
  'landing', 'landing page',
  'start', 'start page',
  'untitled', 'untitled document', 'new page',
  // Generic home / landing page labels (Cyrillic Bulgarian)
  'начална страница',   // "Home page"
  'начало',             // "Home" / "Start"
  'добре дошли',        // "Welcome"
  'добре дошли!',
  // Language-switcher button text extracted as site name
  'english version', 'bg version', 'en version', 'bg', 'en',
]);

// Returns true when the string is a generic auth/page label that can never
// be a real company name.  Safe to call with null/undefined.
export function isGenericAuthName(name?: string | null): boolean {
  if (!name) return false;
  const normalised = name
    .toLowerCase()
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
  return GENERIC_AUTH_NAME_SET.has(normalised);
}

// Extracts a company-name candidate from the first plausible logo <img> alt text.
// Tries progressively broader logo-selector patterns; skips strings that are
// self-descriptions of the image ("logo", "site logo", "CrossCycle logo", …).
function extractLogoAlt($: cheerio.CheerioAPI): string | undefined {
  const selectors = [
    'a[class*="logo"] img',
    'a[id*="logo"] img',
    'img[class*="logo"]',
    'img[id*="logo"]',
    '.site-logo img, #site-logo img',
    'header a img:first-child',
  ];
  for (const sel of selectors) {
    let found: string | undefined;
    $(sel).each((_i, el) => {
      if (found) return;
      const raw = ($(el).attr('alt') ?? '').trim();
      // Take only the first segment when the alt has a separator ("Brand — tagline")
      const alt = raw.split(/[|\-–]/)[0].trim();
      if (!alt || alt.length < 2 || alt.length > 80) return;
      // Reject self-descriptions of the image
      if (/^(logo|icon|image|img|banner|site logo|company logo|header logo)$/i.test(alt)) return;
      if (/\s+(logo|icon)$/i.test(alt)) return; // "CrossCycle Logo" → skip
      if (/\.(png|jpg|gif|svg|webp|ico)$/i.test(alt)) return; // filename in alt
      if (isGenericAuthName(alt)) return;
      found = alt;
    });
    if (found) return found;
  }
  return undefined;
}

// Short segments that appear in domain bodies but are not part of a company name
// (country codes, legal suffixes, generic words).
const DOMAIN_NOISE_WORDS = new Set([
  'bg', 'eu', 'uk', 'us', 'de', 'fr', 'ro', 'mk', 'rs', 'gr',
  'ltd', 'llc', 'inc', 'gmbh', 'ood', 'eood', 'ad', 'web', 'site',
]);

// Derives a readable company name from the homepage URL when all richer sources
// have been exhausted.  "tashev-trans.bg" → "Tashev Trans".
function extractDomainName(url: string): string | undefined {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const domainBody = hostname.split('.')[0]; // "crosscycle" from "crosscycle.bg"
    if (!domainBody || domainBody.length < 3) return undefined;
    const parts = domainBody
      .split(/[-_]/)
      .filter((w) => w.length >= 2 && !DOMAIN_NOISE_WORDS.has(w.toLowerCase()));
    if (parts.length === 0) return undefined;
    return parts
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  } catch {
    return undefined;
  }
}

function extractCompanyName(pages: CrawledPage[]): string | undefined {
  const homepage = pages[0];
  if (!homepage?.html) return undefined;

  const $ = cheerio.load(homepage.html);

  // Priority 1: og:site_name — most authoritative, set explicitly by the CMS
  const ogSite = $('meta[property="og:site_name"]').attr('content')?.trim();
  if (ogSite && !BLOCKED_TITLE_RE.test(ogSite) && !isGenericAuthName(ogSite)) return ogSite;

  // Priority 2: <title> first segment (text before | or -)
  const title = $('title').text().trim();
  if (title) {
    const candidate = title.split(/[|\-–]/)[0].trim();
    if (!BLOCKED_TITLE_RE.test(candidate) && !isGenericAuthName(candidate)) return candidate;
  }

  // Priority 3: logo alt text — sites that set title to a generic value often
  // have a properly-labelled logo image
  const logoAlt = extractLogoAlt($);
  if (logoAlt) return logoAlt;

  // Priority 4: domain-derived name — last resort, better than undefined
  return extractDomainName(homepage.url);
}

// ── Description ───────────────────────────────────────────────────────────────

function extractDescription(pages: CrawledPage[]): string | undefined {
  const homepage = pages[0];
  if (!homepage?.html) return undefined;

  const $ = cheerio.load(homepage.html);

  const metaDesc = $('meta[name="description"]').attr('content')?.trim();
  if (metaDesc && metaDesc.length > 20) return metaDesc;

  const ogDesc = $('meta[property="og:description"]').attr('content')?.trim();
  if (ogDesc && ogDesc.length > 20) return ogDesc;

  let fallback = '';
  $('p').each((_i, el) => {
    const t = $(el).text().trim();
    if (!fallback && t.length > 60) fallback = t;
  });

  return fallback || undefined;
}

// ── Location ──────────────────────────────────────────────────────────────────

// A line must have a STREET INDICATOR to be considered an address.
// This prevents matching years (2022), prices, or history sentences.
const STREET_INDICATORS = [
  /\b(?:str|ul|bul|blvd?|nab)\.\s*["«»]?\w/i,              // Latin Eastern European: ul. / str. (quotes allowed)
  /\bsq\.\s*(?!(?:m|ft|in|km)(?:[.\s]|$))["«»]?\w/i,       // sq. (square) — exclude sq.m./sq.ft./sq.in. area units
  /(?:ул|бул|пл|кв|ж\.к|жк)\.\s*["«»]?\S/iu,               // Cyrillic Bulgarian: ул., бул., пл., кв., ж.к.
  /\b(?:street|avenue|boulevard|road|drive|lane|plaza)\b/i,  // Western
  /(?<![a-zA-Z-])office\s+\d/i,                              // "Office 5" — requires digit after, avoids "back-office transformations"
  /\b(?:address|registered\s+office|headquarters?|hq)\s*:/i, // explicit Latin label
  /(?:адрес)\s*:/iu,                                          // explicit Cyrillic label: Адрес:
];

// Regex to detect an address label in a line and extract the address portion after it
const ADDRESS_LABEL_RE = /(?:адрес|address|registered\s+office)\s*:\s*(.+)/iu;

// Detect CSS / style content so we never return it as an address
function looksLikeCss(text: string): boolean {
  return /[{}]|!important|:\s*#[0-9a-f]{3,6}|:\s*\d+px|rgba?\(|border|margin|padding|font-size|background/i.test(text);
}

// Detect Apache/Nginx server banners that appear in <address> on error pages
function looksLikeServerBanner(text: string): boolean {
  return /^apache\b|^nginx\b|^microsoft-iis\b|server at .+ port \d+/i.test(text);
}

function extractLocation(pages: CrawledPage[]): string | undefined {
  // 1. Semantic <address> HTML element
  for (const page of pages) {
    if (!page.html) continue;
    const $ = cheerio.load(page.html);
    const text = $('address').first().text().replace(/\s+/g, ' ').trim();
    if (text.length > 8 && !looksLikeCss(text) && !looksLikeServerBanner(text)) return text;
  }

  // 2. Elements with explicit "address" in class (NOT "location" — too broad)
  // Split raw text by newlines BEFORE collapsing whitespace so we can isolate
  // the street line from surrounding headings/breadcrumbs in the same element.
  for (const page of pages) {
    if (!page.html) continue;
    const $ = cheerio.load(page.html);
    let found: string | undefined;
    $('[class*="address"]').each((_i, el) => {
      if (found) return;
      const rawText = $(el).text();
      // Split by newlines first, then normalise each line individually
      const lines = rawText
        .split(/[\n\r]+/)
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter((l) => l.length > 5 && l.length < 200 && !looksLikeCss(l) && !l.includes('<'));
      // Prefer the line that contains a street indicator
      const streetLine = lines.find((l) => STREET_INDICATORS.some((re) => re.test(l)));
      if (streetLine) {
        found = streetLine.replace(/[,;]\s*$/, '');
      } else if (lines.length > 0) {
        // Fallback: shortest non-empty line (likely the address, not surrounding headings)
        const shortest = lines.reduce((a, b) => (a.length <= b.length ? a : b));
        if (shortest.length < 150) found = shortest.replace(/[,;]\s*$/, '');
      }
    });
    if (found) return found;
  }

  // 3. Text-based: lines that contain a street indicator (not just any 4-digit number)
  const combined = pages.map((p) => p.text).join('\n');
  const lines = combined
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 8 && l.length < 200);

  const addresses: string[] = [];
  const seenKeys = new Set<string>();

  for (const line of lines) {
    // Must have a street indicator — this rejects "established in 2022" etc.
    if (!STREET_INDICATORS.some((re) => re.test(line))) continue;
    if (looksLikeCss(line)) continue;
    // Skip lines containing raw HTML angle brackets — JSON-LD / inline script bleed
    if (line.includes('<') || line.includes('>')) continue;

    // If the line is long (legal text, footer paragraphs), try to extract just
    // the address portion rather than the whole sentence.
    let candidate = line;
    const labelMatch = line.match(ADDRESS_LABEL_RE);
    if (labelMatch) {
      // "Адрес: Варна, бул. Генерал Колев 54" → take everything after the colon
      candidate = labelMatch[1].trim();
    } else if (line.length > 80) {
      // No explicit label but long line — find where the street indicator starts
      // and take from the last word-break before it to end of line
      for (const re of STREET_INDICATORS) {
        const m = line.match(new RegExp(re.source, re.flags.replace('g', '')));
        if (m?.index !== undefined) {
          const start = line.lastIndexOf(' ', m.index - 1) + 1;
          candidate = line.slice(start);
          break;
        }
      }
    }

    const cleaned = candidate.replace(/[,;.]\s*$/, '').trim();
    if (cleaned.length < 5) continue;
    const key = cleaned.toLowerCase().replace(/\s/g, '');
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    addresses.push(cleaned);
    if (addresses.length >= 2) break;
  }

  return addresses.length ? addresses.join(' | ') : undefined;
}

// ── Services ──────────────────────────────────────────────────────────────────

const SERVICE_HEADING_RE = /^(?:services?|what we (?:do|offer|provide|build)|our (?:services?|solutions?|work|expertise)|capabilities?|specializ\w+)$/i;
const SERVICE_CONTEXT_RE = /service|solution|what we (do|offer|provide|build)|our work|expertise|capabilities|specializ/i;

// Stop scanning when we hit the start of a clearly different section
const STOP_SECTION_RE  = /^(?:about\s*us?|our\s*team|meet\s*(?:our|the)\s*team|contact\s*(?:us)?|clients?|partners?|testimonials?|blog|news|portfolio|pricing|home|get\s*in\s*touch|careers?)$/i;

function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

// Strings that are never real service names — test/debug entries, CMS render
// failures, JS placeholder values, and UI loading/error states.
// Anchored (^ $) so "Error handling" or "Testing strategy" are not rejected.
const JUNK_SERVICE_RE =
  /^(?:test\s*\d*|demo|placeholder|sample|example|lorem(?:\s+ipsum)?|debug|undefined|null|nan|n\/a|error[:\s!.…]*|warning[:\s!.…]*|loading[.…]*)$/i;

export function isJunkService(s: string): boolean {
  return JUNK_SERVICE_RE.test(s.trim());
}

function extractServicesFromHtml(pages: CrawledPage[]): Set<string> {
  const items = new Set<string>();

  for (const page of pages) {
    if (!page.html) continue;
    const $ = cheerio.load(page.html);

    // Strategy 1: heading with service keywords → adjacent list or sibling cards
    $('h1, h2, h3, h4').each((_i, el) => {
      const heading = $(el).text().toLowerCase().trim();
      if (!SERVICE_CONTEXT_RE.test(heading)) return;

      // Adjacent <ul>/<ol>
      $(el).nextAll('ul, ol').first().find('li').each((_j, li) => {
        const t = normalizeTitle($(li).clone().children('ul, ol').remove().end().text());
        if (t.length > 2 && t.length < 120 && !isJunkService(t)) items.add(t);
      });

      // Cards/headings inside the nearest section/div container
      $(el).closest('section, div[class]').find('h3, h4, [class*="card"] h3, [class*="service"] h4, [class*="item"] h4').each((_j, card) => {
        if (card === el) return;
        const t = normalizeTitle($(card).text());
        if (t.length > 2 && t.length < 120 && !SERVICE_CONTEXT_RE.test(t.toLowerCase()) && !isJunkService(t)) items.add(t);
      });
    });

    // Strategy 2: elements whose class name signals a service block
    $('[class*="service"],[class*="solution"],[class*="offering"],[class*="capability"],[class*="feature"]').each((_i, el) => {
      // Skip the outer wrapper (it would grab the section heading)
      if ($(el).find('[class*="service"],[class*="card"],[class*="item"]').length > 2) return;
      const title = normalizeTitle($(el).find('h2, h3, h4, strong').first().text());
      if (title.length > 2 && title.length < 120 && !isJunkService(title)) items.add(title);
    });

    // Strategy 3: service/item title classes — handles grid layouts where individual
    // cards don't carry "service" in their class (e.g. item-title, service-title).
    // Only runs when Strategies 1 & 2 found nothing, to avoid duplicate noise.
    if (items.size === 0) {
      $('[class*="item-title"],[class*="service-title"],[class*="card-title"],[class*="tile-title"]').each((_i, el) => {
        const t = normalizeTitle($(el).text());
        if (t.length > 2 && t.length < 120 && !SERVICE_CONTEXT_RE.test(t.toLowerCase()) && !isJunkService(t)) items.add(t);
      });
    }
  }

  return items;
}

/**
 * Text-based fallback — works even when the services section is JS-rendered
 * (Cheerio gets the text via $.text() before JS hydration is stripped).
 */
function extractServicesFromText(pages: CrawledPage[]): string[] {
  for (const page of pages) {
    const lines = page.text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    let collecting = false;
    const items: string[] = [];

    for (const line of lines) {
      if (SERVICE_HEADING_RE.test(line)) {
        collecting = true;
        continue;
      }
      if (!collecting) continue;
      if (STOP_SECTION_RE.test(line)) break;

      // Skip lines that are sentences, too long, or purely numeric
      if (line.length < 3 || line.length > 80) continue;
      if (/[.!?]$/.test(line)) continue;
      if (/^\d+$/.test(line)) continue;
      // Skip lines that look like nav links or generic words
      if (/^(?:home|contact|about|company|team|people|staff|blog|login|sign\s*in|read\s*more|learn\s*more|get\s*started|careers?|portfolio)$/i.test(line)) continue;
      if (isJunkService(line)) continue;

      items.push(line);
      if (items.length >= 15) break;
    }

    if (items.length >= 2) return items;
  }
  return [];
}

function extractServices(pages: CrawledPage[]): string[] {
  const htmlItems = extractServicesFromHtml(pages);
  if (htmlItems.size > 0) return [...htmlItems].slice(0, 20);

  // Fallback: text-based scan (handles SSR pages where JS sections aren't in static HTML)
  return extractServicesFromText(pages);
}

// ── Team ──────────────────────────────────────────────────────────────────────

// Selectors for person cards — ordered from specific to broad
const TEAM_CARD_SELECTORS = [
  '[class*="team-member"], [class*="team-card"], [class*="team-item"]',
  '[class*="member-card"], [class*="person-card"], [class*="staff-card"]',
  '[class*="team"] [class*="card"], [class*="team"] [class*="item"], [class*="team"] article',
  '[class*="member"], [class*="person"], [class*="staff"], [class*="employee"]',
  '[class*="people"] [class*="card"], [class*="people"] article',
  '[class*="bio"], [class*="profile-card"]',
];

const NAME_SELECTORS   = 'h2, h3, h4, [class*="name"], strong';
const ROLE_SELECTORS   = 'p, span, [class*="role"], [class*="title"], [class*="position"], [class*="job"], em, small';
const EMAIL_RE_LOCAL   = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
// Individual LinkedIn profile URLs — linkedin.com/in/<slug>
const LINKEDIN_PROFILE_RE = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\s"'<>?#]+/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractLinkedIn($el: any, $: cheerio.CheerioAPI): string | undefined {
  // First check hrefs of <a> tags inside the card
  let url: string | undefined;
  $el.find('a[href*="linkedin.com/in/"]').each((_i: number, a: any) => {
    if (url) return;
    const href = $(a).attr('href') ?? '';
    const m = href.match(LINKEDIN_PROFILE_RE);
    if (m) url = m[0].replace(/\/$/, ''); // strip trailing slash
  });
  return url;
}

// ── Team: role-label dictionaries & helpers ───────────────────────────────────

const ROLE_LABELS_EN = [
  'ceo', 'cfo', 'cto', 'coo', 'cso', 'cmo', 'cpo',
  'managing director', 'executive director', 'financial director', 'director',
  'general manager', 'sales manager', 'project manager', 'office manager',
  'account manager', 'marketing manager', 'operations manager', 'manager',
  'vice president', 'president', 'chairman', 'vp',
  'head of sales', 'head of marketing', 'head of finance', 'head of operations',
  'managing partner', 'partner',
  'sales representative', 'representative', 'contact person', 'contact',
  'accountant', 'bookkeeper', 'administrator',
  'owner', 'co-owner', 'co owner', 'founder', 'co-founder', 'co founder',
];

const ROLE_LABELS_BG = [
  'изпълнителен директор', 'търговски директор', 'финансов директор',
  'административен директор', 'оперативен директор',
  'управител', 'съуправител',
  'собственик', 'съсобственик', 'съдружник',
  'директор',
  'мениджър продажби', 'офис мениджър', 'проектен мениджър', 'мениджър',
  'главен счетоводител', 'счетоводител', 'финансист',
  'търговски представител', 'представител',
  'лице за контакт', 'за контакт',
  'изпълнителен партньор', 'партньор',
];

// Sorted longest-first so multi-word roles are matched before their substrings.
const ALL_ROLE_LABELS = [...new Set([...ROLE_LABELS_EN, ...ROLE_LABELS_BG])]
  .sort((a, b) => b.length - a.length);
const ROLE_LABEL_SET = new Set(ALL_ROLE_LABELS);

// ── Site-language helpers (used by team quality gate) ─────────────────────────

type Script = 'cyrillic' | 'latin' | 'mixed';

// Returns 'cyrillic' when >50 % of script chars across all pages are Cyrillic.
// Used to detect language mismatch: English demo names on a Bulgarian site.
function siteScript(pages: CrawledPage[]): Script {
  let cyr = 0, lat = 0;
  for (const p of pages) {
    cyr += (p.text.match(/[Ѐ-ӿ]/g) ?? []).length;
    lat += (p.text.match(/[a-zA-Z]/g) ?? []).length;
  }
  const tot = cyr + lat;
  if (tot < 200) return 'mixed';
  const frac = cyr / tot;
  return frac > 0.50 ? 'cyrillic' : frac < 0.25 ? 'latin' : 'mixed';
}

function nameScript(name: string): Script {
  const cyr = (name.match(/[Ѐ-ӿ]/g) ?? []).length;
  const lat = (name.match(/[a-zA-Z]/g) ?? []).length;
  if (cyr > 0 && lat === 0) return 'cyrillic';
  if (lat > 0 && cyr === 0) return 'latin';
  return 'mixed';
}

function pageDomain(pages: CrawledPage[]): string {
  try { return new URL(pages[0].url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

// Returns true when email belongs to the company's own domain (or a subdomain).
function isCompanyDomainEmail(email: string, domain: string): boolean {
  if (!domain || !email) return false;
  const low = email.toLowerCase();
  return low.endsWith('@' + domain) || low.endsWith('.' + domain);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns the original string if it is a known role label, null otherwise.
function matchRoleLabel(s: string): string | null {
  const low = s.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[-_]+/g, ' ');
  return ROLE_LABEL_SET.has(low) ? s.trim() : null;
}

// Matches "FirstName LastName" or "Иван Иванов": every word starts with one
// uppercase Unicode letter followed by 1+ lowercase letters; requires ≥2 words.
const PERSON_NAME_RE = /^[\p{Lu}][\p{Ll}]{1,}(?:[\s\-][\p{Lu}][\p{Ll}]{1,})+$/u;

// Contact-form placeholder text that satisfies PERSON_NAME_RE structurally but
// is never a real person (e.g. the default value of an HTML <input name="name">).
const PERSON_PLACEHOLDER_SET = new Set([
  'first name', 'last name', 'full name', 'your name',
  'firstname', 'lastname', 'fullname',
  'name surname', 'name lastname', 'your full name',
]);

function isPersonName(s: string): boolean {
  const t = s.trim();
  if (!PERSON_NAME_RE.test(t)) return false;
  if (matchRoleLabel(t)) return false;
  if (PERSON_PLACEHOLDER_SET.has(t.toLowerCase())) return false;
  return true;
}

// ── Strategy 4: role-label text-pattern extraction ────────────────────────────
// Handles lines like:
//   "Управител: Иван Иванов"   (ROLE: NAME)
//   "Иван Иванов - управител"  (NAME - ROLE)
//   "CEO - John Smith"         (ROLE - NAME)

function extractTextPatternMembers(pages: CrawledPage[], seen: Set<string>): TeamMember[] {
  const found: TeamMember[] = [];

  for (const page of pages) {
    const lines = page.text.split('\n').map((l) => l.trim()).filter((l) => l.length >= 5 && l.length <= 150);

    for (const line of lines) {
      // Pattern A: "ROLE: NAME"
      const colonIdx = line.indexOf(':');
      if (colonIdx > 1 && colonIdx < line.length - 2) {
        const left  = line.slice(0, colonIdx).trim();
        const right = line.slice(colonIdx + 1).trim();
        const role  = matchRoleLabel(left);
        if (role && isPersonName(right)) {
          const key = right.toLowerCase();
          if (!seen.has(key)) { seen.add(key); found.push({ name: right, position: role }); }
          continue;
        }
      }

      // Pattern B: "NAME — ROLE" or "ROLE — NAME" (dash / en-dash / em-dash)
      const dashMatch = line.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      if (dashMatch) {
        const [, p1, p2] = dashMatch;
        const role1 = matchRoleLabel(p1);
        const role2 = matchRoleLabel(p2);
        if (role2 && isPersonName(p1.trim())) {
          const key = p1.trim().toLowerCase();
          if (!seen.has(key)) { seen.add(key); found.push({ name: p1.trim(), position: p2.trim() }); }
        } else if (role1 && isPersonName(p2.trim())) {
          const key = p2.trim().toLowerCase();
          if (!seen.has(key)) { seen.add(key); found.push({ name: p2.trim(), position: p1.trim() }); }
        }
      }
    }
  }

  return found;
}

// ── Strategy 5: mailto-proximity extraction ────────────────────────────────────
// Finds <a href="mailto:…"> links and looks for a role label in the surrounding
// DOM context.  Also attempts to extract a person name from the same context.

function extractMailtoMembers(pages: CrawledPage[], seen: Set<string>): TeamMember[] {
  const found: TeamMember[] = [];

  for (const page of pages) {
    if (!page.html) continue;
    const $ = cheerio.load(page.html);

    $('a[href^="mailto:"]').each((_i, el) => {
      const href  = $(el).attr('href') ?? '';
      const email = href.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
      if (!email || !EMAIL_RE_LOCAL.test(email)) return;
      if (seen.has(email)) return;

      // Gather text from the nearest meaningful ancestor block element.
      const $ctx = $(el).closest('div, li, td, p, section, article').first();
      const contextText = ($ctx.length ? $ctx : $(el).parent()).text().replace(/\s+/g, ' ').trim();

      // Require a role label in the context; otherwise too many false positives.
      let foundRole: string | null = null;
      for (const roleLabel of ALL_ROLE_LABELS) {
        if (new RegExp(`(?:^|[\\s,.:;(\\-])${escapeRegex(roleLabel)}(?:[\\s,.:;)\\-]|$)`, 'iu').test(contextText)) {
          foundRole = roleLabel;
          break;
        }
      }
      if (!foundRole) return;

      // Try to extract a person name: look for any "Firstname Lastname" pattern.
      let foundName: string | null = null;
      for (const m of contextText.match(/[\p{Lu}][\p{Ll}]{1,}(?:\s[\p{Lu}][\p{Ll}]{1,})+/gu) ?? []) {
        if (!matchRoleLabel(m)) { foundName = m; break; }
      }

      seen.add(email);
      found.push({
        name:     foundName ?? undefined,
        position: foundRole,
        email,
      });
    });
  }

  return found;
}

function extractTeam(pages: CrawledPage[]): TeamMember[] {
  const members: TeamMember[] = [];
  const seen = new Set<string>();

  // Computed once — used by the language-mismatch quality gate on all strategies.
  const siteLang = siteScript(pages);
  const domain   = pageDomain(pages);

  // Returns true when this section should be rejected:
  // Cyrillic-dominant site + every extracted name is Latin + no company-domain email.
  // This catches Elementor / Avada / WPBakery demo "Our Team" widgets that ship
  // with placeholder English names (John Portman, Kelley Miles, Sherman Warner, …)
  // on Bulgarian-language websites.
  function sectionIsDemo(
    candidates: Array<{ member: TeamMember; sc: Script }>,
  ): boolean {
    if (siteLang !== 'cyrillic') return false;
    const allLatin = candidates.every((c) => c.sc === 'latin');
    if (!allLatin) return false;
    const hasCompanyEmail = candidates.some(
      (c) => !!c.member.email && isCompanyDomainEmail(c.member.email, domain),
    );
    return !hasCompanyEmail;
  }

  for (const page of pages) {
    if (!page.html) continue;
    const $ = cheerio.load(page.html);

    // Strategy 1: try known card selectors ─────────────────────────────────────
    for (const sel of TEAM_CARD_SELECTORS) {
      const cards = $(sel);
      if (cards.length === 0) continue;

      const candidates: Array<{ member: TeamMember; sc: Script }> = [];

      cards.each((_i, card) => {
        const $card = $(card);
        const rawName = $card.find(NAME_SELECTORS).first().text().trim().split('\n')[0].trim();
        if (!rawName || rawName.length < 2 || rawName.length > 80) return;
        if (!isPersonName(rawName)) return; // reject section headings, service names, etc.
        if (seen.has(rawName.toLowerCase())) return;

        const rawRole = $card.find(ROLE_SELECTORS).first().text().trim().split('\n')[0].trim();
        const position = rawRole && rawRole !== rawName && rawRole.length < 100 ? rawRole : undefined;
        const emailMatch = $card.text().match(EMAIL_RE_LOCAL);
        const linkedin = extractLinkedIn($card, $);

        candidates.push({
          member: { name: rawName, position, email: emailMatch?.[0], linkedin },
          sc: nameScript(rawName),
        });
      });

      if (candidates.length === 0) continue;
      if (sectionIsDemo(candidates)) continue; // language mismatch — likely demo content

      for (const { member } of candidates) {
        const key = member.name!.toLowerCase();
        if (!seen.has(key)) { seen.add(key); members.push(member); }
      }
      break; // found a valid section — stop trying further selectors
    }

    // Strategy 2: section heading "team/people/екип/ръководство/…" → sibling headings = names
    if (members.length === 0) {
      const candidates: Array<{ member: TeamMember; sc: Script }> = [];

      $('h1, h2, h3').each((_i, el) => {
        const headingText = $(el).text().toLowerCase();
        if (!/(?:our\s+)?(?:team|people|staff)|meet\s+(?:our|the)|екип|ръководство|управлени[ея]|нашият?\s+екип/.test(headingText)) return;

        $(el).closest('section, div').find('h3, h4').each((_j, nameEl) => {
          if (nameEl === el) return;
          const name = $(nameEl).text().trim().split('\n')[0].trim();
          if (!name || name.length < 2 || name.length > 80) return;
          if (!isPersonName(name)) return;
          if (seen.has(name.toLowerCase())) return;

          const rawRole = $(nameEl).next(ROLE_SELECTORS).first().text().trim().split('\n')[0].trim();
          const position = rawRole && rawRole.length < 100 ? rawRole : undefined;
          candidates.push({ member: { name, position }, sc: nameScript(name) });
        });
      });

      if (candidates.length > 0 && !sectionIsDemo(candidates)) {
        for (const { member } of candidates) {
          const key = member.name!.toLowerCase();
          if (!seen.has(key)) { seen.add(key); members.push(member); }
        }
      }
    }

    // Strategy 3: page-builder layouts (WPBakery, Elementor, Divi) where names are
    // rendered as bold <p> elements rather than headings.  Only activates when a
    // "meet / team / management" section heading is present on the page.
    if (members.length === 0) {
      const hasTeamSection = $('h1, h2, h3').toArray().some(
        (el) => /(?:meet|team|management|staff|people)|екип|ръководство|управлени[ея]/i.test($(el).text()),
      );
      if (!hasTeamSection) continue;

      // eslint-disable-next-line no-misleading-character-class
      const FULL_NAME_RE = /^[\p{Lu}][\p{Ll}]+(?:\s[\p{Lu}][\p{Ll}]+)+$/u;
      const candidates: Array<{ member: TeamMember; sc: Script }> = [];

      $('p[style]').each((_i, el) => {
        const style = $(el).attr('style') ?? '';
        if (!/font-weight\s*:\s*(?:bold|[6-9]\d\d)/i.test(style)) return;

        const text = $(el).text().trim().replace(/\s+/g, ' ');
        if (!FULL_NAME_RE.test(text)) return;
        if (seen.has(text.toLowerCase())) return;

        const $next = $(el).next('p');
        const rawRole = $next.text().trim().split('\n')[0].trim().replace(/\s+/g, ' ');
        const position =
          rawRole && rawRole !== text && rawRole.length < 100 && !FULL_NAME_RE.test(rawRole)
            ? rawRole
            : undefined;

        const emailMatch = $(el).closest('div').text().match(EMAIL_RE_LOCAL);
        candidates.push({
          member: { name: text, position, email: emailMatch?.[0] },
          sc: nameScript(text),
        });
      });

      if (candidates.length > 0 && !sectionIsDemo(candidates)) {
        for (const { member } of candidates) {
          const key = member.name!.toLowerCase();
          if (!seen.has(key)) { seen.add(key); members.push(member); }
        }
      }
    }
  }

  // Strategy 4: text-pattern extraction — evidence-based (always has role label).
  for (const m of extractTextPatternMembers(pages, seen)) members.push(m);

  // Strategy 5: mailto-proximity — evidence-based (requires role label near mailto).
  for (const m of extractMailtoMembers(pages, seen)) members.push(m);

  return members.slice(0, 50);
}

// ── History ───────────────────────────────────────────────────────────────────

function extractHistory(pages: CrawledPage[]): string | undefined {
  const aboutPage = pages.find((p) => p.url.includes('/about') || p.url.includes('/history'));
  if (!aboutPage?.html) return undefined;

  const $ = cheerio.load(aboutPage.html);
  let history = '';

  $('h2, h3').each((_i, el) => {
    const heading = $(el).text().toLowerCase();
    if (heading.includes('histor') || heading.includes('about') || heading.includes('founded')) {
      const next = $(el).next('p');
      if (next.length) history = next.text().trim();
    }
  });

  return history || undefined;
}

// ── Completion score ──────────────────────────────────────────────────────────

const FIELD_WEIGHTS: Record<string, number> = {
  name: 20,
  description: 20,
  location: 10,
  emails: 15,
  phones: 10,
  services: 10,
  team: 5,
  history: 5,
  socialLinks: 5,
};

function computeCompletionScore(profile: Omit<ExtractedProfile, 'completionScore'>): number {
  let score = 0;
  if (profile.name)                            score += FIELD_WEIGHTS.name;
  if (profile.description)                     score += FIELD_WEIGHTS.description;
  if (profile.location)                        score += FIELD_WEIGHTS.location;
  if (profile.emails.length > 0)               score += FIELD_WEIGHTS.emails;
  if (profile.phones.length > 0)               score += FIELD_WEIGHTS.phones;
  if (profile.services.length > 0)             score += FIELD_WEIGHTS.services;
  if (profile.team.length > 0)                 score += FIELD_WEIGHTS.team;
  if (profile.history)                         score += FIELD_WEIGHTS.history;
  if (Object.keys(profile.socialLinks).length) score += FIELD_WEIGHTS.socialLinks;
  return score;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function extractProfile(pages: CrawledPage[]): ExtractedProfile {
  const allEmails = [...new Set(pages.flatMap((p) => p.emails))];
  // Dedup phones across pages by canonical form so formatting variants and
  // local/international representations of the same number are stored only once.
  // "0893 / 35 41 42" and "0893/35 41 42" → same; "0875 300 000" and
  // "+359 875 300 000" → same canonical "+359875300000", international form wins.
  const phoneMap = new Map<string, string>();
  for (const page of pages) {
    for (const phone of page.phones) {
      const norm = normalizePhone(phone);
      const canonical = canonicalizePhone(norm);
      if (!phoneMap.has(canonical)) {
        phoneMap.set(canonical, phone);
      } else if (norm.startsWith('+') && !normalizePhone(phoneMap.get(canonical)!).startsWith('+')) {
        phoneMap.set(canonical, phone);
      }
    }
  }
  const allPhones = [...phoneMap.values()];

  const base = {
    name:        extractCompanyName(pages),
    description: extractDescription(pages),
    location:    extractLocation(pages),
    emails:      allEmails,
    phones:      allPhones,
    services:    extractServices(pages),
    team:        extractTeam(pages),
    history:     extractHistory(pages),
    socialLinks: extractSocialLinks(pages),
  };

  return { ...base, completionScore: computeCompletionScore(base) };
}
