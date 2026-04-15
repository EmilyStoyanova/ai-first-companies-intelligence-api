import * as cheerio from 'cheerio';
import { CrawledPage } from '../worker/crawl';

export interface TeamMember {
  name: string;
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
  'twitter.com': 'twitter',
  'x.com': 'twitter',
  'instagram.com': 'instagram',
  'youtube.com': 'youtube',
};

// ── Social links ──────────────────────────────────────────────────────────────

function extractSocialLinks(pages: CrawledPage[]): Record<string, string> {
  const links: Record<string, string> = {};
  const LINK_RE = /https?:\/\/(www\.)?([\w.-]+)\.[a-z]{2,}\/[\w./?=&%-]*/gi;

  for (const page of pages) {
    const matches = page.html.match(LINK_RE) ?? [];
    for (const m of matches) {
      try {
        const url = new URL(m);
        const hostname = url.hostname.replace(/^www\./, '');
        for (const [domain, key] of Object.entries(SOCIAL_DOMAINS)) {
          if (hostname === domain || hostname.endsWith(`.${domain}`)) {
            if (!links[key]) links[key] = m;
          }
        }
      } catch { /* ignore */ }
    }
  }
  return links;
}

// ── Company name ──────────────────────────────────────────────────────────────

function extractCompanyName(pages: CrawledPage[]): string | undefined {
  const homepage = pages[0];
  if (!homepage?.html) return undefined;

  const $ = cheerio.load(homepage.html);

  const ogSite = $('meta[property="og:site_name"]').attr('content');
  if (ogSite) return ogSite.trim();

  const title = $('title').text().trim();
  if (title) return title.split(/[|\-–]/)[0].trim();

  return undefined;
}

// ── Description ───────────────────────────────────────────────────────────────

function extractDescription(pages: CrawledPage[]): string | undefined {
  const homepage = pages[0];
  if (!homepage?.html) return undefined;

  const $ = cheerio.load(homepage.html);

  const MAX_DESC = 300;

  const metaDesc = $('meta[name="description"]').attr('content')?.trim();
  if (metaDesc && metaDesc.length > 20) {
    return metaDesc.length > MAX_DESC ? metaDesc.slice(0, MAX_DESC).trimEnd() + '…' : metaDesc;
  }

  const ogDesc = $('meta[property="og:description"]').attr('content')?.trim();
  if (ogDesc && ogDesc.length > 20) {
    return ogDesc.length > MAX_DESC ? ogDesc.slice(0, MAX_DESC).trimEnd() + '…' : ogDesc;
  }

  let fallback = '';
  $('p').each((_i, el) => {
    const t = $(el).text().trim();
    if (!fallback && t.length > 60) fallback = t;
  });

  if (!fallback) return undefined;
  return fallback.length > MAX_DESC ? fallback.slice(0, MAX_DESC).trimEnd() + '…' : fallback;
}

// ── Location ──────────────────────────────────────────────────────────────────

// A line must have a STREET INDICATOR to be considered an address.
// This prevents matching years (2022), prices, or history sentences.
const STREET_INDICATORS = [
  /\b(?:str|ul|bul|blvd?|nab|sq)\.\s*["«»]?\w/i,           // Latin Eastern European: ul. / str. (quotes allowed)
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
        if (t.length > 2 && t.length < 120) items.add(t);
      });

      // Cards/headings inside the nearest section/div container
      $(el).closest('section, div[class]').find('h3, h4, [class*="card"] h3, [class*="service"] h4, [class*="item"] h4').each((_j, card) => {
        if (card === el) return;
        const t = normalizeTitle($(card).text());
        if (t.length > 2 && t.length < 120 && !SERVICE_CONTEXT_RE.test(t.toLowerCase())) items.add(t);
      });
    });

    // Strategy 2: elements whose class name signals a service block
    $('[class*="service"],[class*="solution"],[class*="offering"],[class*="capability"],[class*="feature"]').each((_i, el) => {
      // Skip the outer wrapper (it would grab the section heading)
      if ($(el).find('[class*="service"],[class*="card"],[class*="item"]').length > 2) return;
      const title = normalizeTitle($(el).find('h2, h3, h4, strong').first().text());
      if (title.length > 2 && title.length < 120) items.add(title);
    });

    // Strategy 3: service/item title classes — handles grid layouts where individual
    // cards don't carry "service" in their class (e.g. item-title, service-title).
    // Only runs when Strategies 1 & 2 found nothing, to avoid duplicate noise.
    if (items.size === 0) {
      $('[class*="item-title"],[class*="service-title"],[class*="card-title"],[class*="tile-title"]').each((_i, el) => {
        const t = normalizeTitle($(el).text());
        if (t.length > 2 && t.length < 120 && !SERVICE_CONTEXT_RE.test(t.toLowerCase())) items.add(t);
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

function extractLinkedIn($el: cheerio.Cheerio<cheerio.Element>, $: cheerio.CheerioAPI): string | undefined {
  // First check hrefs of <a> tags inside the card
  let url: string | undefined;
  $el.find('a[href*="linkedin.com/in/"]').each((_i, a) => {
    if (url) return;
    const href = $(a).attr('href') ?? '';
    const m = href.match(LINKEDIN_PROFILE_RE);
    if (m) url = m[0].replace(/\/$/, ''); // strip trailing slash
  });
  return url;
}

function extractTeam(pages: CrawledPage[]): TeamMember[] {
  const members: TeamMember[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    if (!page.html) continue;
    const $ = cheerio.load(page.html);

    // Strategy 1: try known card selectors
    for (const sel of TEAM_CARD_SELECTORS) {
      const cards = $(sel);
      if (cards.length === 0) continue;

      cards.each((_i, card) => {
        const $card = $(card);
        const name = $card.find(NAME_SELECTORS).first().text().trim().split('\n')[0].trim();
        if (!name || name.length < 2 || name.length > 80) return;
        if (seen.has(name.toLowerCase())) return;

        const rawRole = $card.find(ROLE_SELECTORS).first().text().trim().split('\n')[0].trim();
        const position = rawRole && rawRole !== name && rawRole.length < 100 ? rawRole : undefined;
        const emailMatch = $card.text().match(EMAIL_RE_LOCAL);
        const linkedin = extractLinkedIn($card, $);

        seen.add(name.toLowerCase());
        members.push({ name, position, email: emailMatch?.[0], linkedin });
      });

      if (members.length > 0) break; // found cards, don't try next selector
    }

    // Strategy 2: section heading "team"/"people"/"meet" → sibling headings = names
    if (members.length === 0) {
      $('h1, h2, h3').each((_i, el) => {
        const headingText = $(el).text().toLowerCase();
        if (!/(?:our\s+)?(?:team|people|staff)|meet\s+(?:our|the)/.test(headingText)) return;

        $(el).closest('section, div').find('h3, h4').each((_j, nameEl) => {
          if (nameEl === el) return;
          const name = $(nameEl).text().trim().split('\n')[0].trim();
          if (!name || name.length < 2 || name.length > 80) return;
          if (seen.has(name.toLowerCase())) return;

          const rawRole = $(nameEl).next(ROLE_SELECTORS).first().text().trim().split('\n')[0].trim();
          const position = rawRole && rawRole.length < 100 ? rawRole : undefined;

          seen.add(name.toLowerCase());
          members.push({ name, position });
        });
      });
    }
  }

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
  const allPhones = [...new Set(pages.flatMap((p) => p.phones))];

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
