import * as cheerio from 'cheerio';
import { domainToUnicode } from 'url';
import type { PageType, PersonaSearchInput } from './types';

// Bulgarian municipality URL path segments that indicate a government/municipality page
const MUNICIPALITY_PATH_SEGMENTS = [
  'obrazovanie', 'obshtinska', 'administracia', 'obstinskisavet', 'obshinskisavet',
  'deynost', 'registri', 'uslugi', 'obshtestveni', 'kmetstvo', 'kmet',
  'detski-gradini', 'detskata-gradini', 'uchilishta', 'zdraveopazvane',
  'sotsialni', 'kultura', 'sport', 'ekologia', 'byudzhet', 'naredbi',
];

// Bulgarian news/media URL path segments
const NEWS_PATH_SEGMENTS = [
  'novini', 'news', 'press', 'aktualno', 'statii', 'blog', 'publikacii',
  'sobitivia', 'arhiv',
];

// Title/text keywords that signal a municipality or government page
const MUNICIPALITY_TEXT_SIGNALS = [
  'община ', 'общинска ', 'кмет ', 'кметство ', 'общински съвет',
  'администрация на', 'официален сайт на община',
];

// Signals that a page is an official registry
const REGISTRY_TEXT_SIGNALS = [
  'регистър на', 'регистри на', 'списък на', 'по реда на', 'по чл.',
  'наредба №', 'заповед №', 'регистрирани',
];

// Signals that a page is a directory/portal aggregating many orgs
const DIRECTORY_TEXT_SIGNALS = [
  'каталог', 'директория', 'пълен списък', 'всички ', 'намерени резулт',
  'сортирай', 'филтрирай', 'покажи повече', 'резулт',
];

// Signals that a page is a news article
const NEWS_TEXT_SIGNALS = [
  'публикувано на ', 'публикувано:', 'автор:', 'прочети повече', 'споделяне',
  'коментари (', 'следваща статия', 'предишна статия', 'тагове:', 'категория:',
];

// Regex for Bulgarian phone numbers
const PHONE_RE = /0[789]\d{2}[\s\-.]?\d{3}[\s\-.]?\d{3}|(?:\+359|00359)\d{2}[\s\-.]?\d{3}[\s\-.]?\d{3}|\d{3,5}[\s\-]\d{3,6}/g;
// Regex for emails
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

type ScoreMap = Partial<Record<PageType, number>>;

function scoreToType(scores: ScoreMap): PageType {
  let best: PageType = 'UNKNOWN';
  let bestScore = 0;
  for (const [type, score] of Object.entries(scores) as [PageType, number][]) {
    if (score > bestScore) {
      bestScore = score;
      best = type;
    }
  }
  return best;
}

export class PageClassifier {
  /**
   * Fast classification using only URL, title and snippet — no HTTP request.
   * Use this to pre-filter before deciding whether to fetch a page.
   */
  classifyFromMeta(
    url: string,
    title: string,
    snippet: string,
    input: PersonaSearchInput,
  ): PageType {
    const scores: ScoreMap = {};
    const add = (type: PageType, pts: number) => { scores[type] = (scores[type] ?? 0) + pts; };

    let urlPath = '';
    let hostname = '';
    try {
      const u = new URL(url);
      urlPath   = u.pathname.toLowerCase();
      hostname  = u.hostname.toLowerCase().replace(/^www\./, '');
    } catch { /* ignore invalid URLs */ }

    // Decode punycode/IDN hostnames (e.g. xn--80afcccsdam9a3aim.xn--90ae → детскиградини.бг)
    let unicodeHostname = hostname;
    try { unicodeHostname = domainToUnicode(hostname).toLowerCase(); } catch { /* ignore */ }

    // ── Hostname-level signals ──────────────────────────────────────────────
    // ASCII patterns that signal a registry or catalog domain (transliterated Bulgarian)
    if (/registar|registrar|regisar/.test(hostname)) {
      add('OFFICIAL_REGISTRY', 60);
    }
    if (/katalog|catalog|kataloq|portal|directory/.test(hostname)) {
      add('DIRECTORY_OR_PORTAL', 50);
    }
    // If all significant persona words appear in the Unicode hostname, it's a category portal
    // (e.g. "детски градини" ⊆ "детскиградини.бг")
    const personaWords = input.persona.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const unicodeBase  = unicodeHostname.replace(/\./g, '');
    if (personaWords.length >= 2 && personaWords.every(w => unicodeBase.includes(w))) {
      add('DIRECTORY_OR_PORTAL', 60);
    }

    const combined = `${title} ${snippet}`.toLowerCase();

    // ── Social media ────────────────────────────────────────────────────────
    if (/^https?:\/\/(www\.)?(facebook|twitter|instagram|linkedin|youtube|tiktok)\.com/i.test(url)) {
      add('SOCIAL_PAGE', 100);
    }

    // ── News signals ────────────────────────────────────────────────────────
    if (NEWS_PATH_SEGMENTS.some(s => urlPath.includes(`/${s}`))) {
      add('NEWS_ARTICLE', 50);
    }
    if (NEWS_TEXT_SIGNALS.some(s => combined.includes(s))) {
      add('NEWS_ARTICLE', 40);
    }

    // ── Municipality signals ────────────────────────────────────────────────
    if (MUNICIPALITY_PATH_SEGMENTS.some(s => urlPath.includes(`/${s}`))) {
      add('MUNICIPALITY_PAGE', 50);
    }
    const municipalityTitleHits = MUNICIPALITY_TEXT_SIGNALS.filter(s => combined.includes(s)).length;
    if (municipalityTitleHits > 0) add('MUNICIPALITY_PAGE', municipalityTitleHits * 30);

    // ── Registry signals ────────────────────────────────────────────────────
    if (REGISTRY_TEXT_SIGNALS.some(s => combined.includes(s))) {
      add('OFFICIAL_REGISTRY', 40);
      add('MUNICIPALITY_PAGE', 20); // registries are often on municipality sites
    }

    // ── Directory / portal signals ──────────────────────────────────────────
    if (DIRECTORY_TEXT_SIGNALS.some(s => combined.includes(s))) {
      add('DIRECTORY_OR_PORTAL', 50);
    }
    // Multiple occurrences of a persona-like keyword in the snippet = listing page
    const shortWords = combined.split(/\s+/).filter(w => w.length > 3);
    const repetitionCounts = new Map<string, number>();
    for (const w of shortWords) {
      repetitionCounts.set(w, (repetitionCounts.get(w) ?? 0) + 1);
    }
    const maxRepetition = Math.max(0, ...repetitionCounts.values());
    if (maxRepetition >= 4) add('DIRECTORY_OR_PORTAL', 30);

    // ── Target organization signals ─────────────────────────────────────────
    // If we have no strong signals toward municipality/directory/news, give a small
    // baseline boost toward TARGET_ORGANIZATION so that an empty-signal page
    // becomes UNKNOWN rather than defaulting to one of the negative types.
    const negativeTotal =
      (scores.MUNICIPALITY_PAGE ?? 0) +
      (scores.DIRECTORY_OR_PORTAL ?? 0) +
      (scores.NEWS_ARTICLE ?? 0) +
      (scores.OFFICIAL_REGISTRY ?? 0);
    if (negativeTotal === 0) {
      add('TARGET_ORGANIZATION', 20);
    }

    const result = scoreToType(scores);
    // Below-threshold → UNKNOWN (let content classifier decide)
    const winner = scores[result] ?? 0;
    if (winner < 30) return 'UNKNOWN';
    return result;
  }

  /**
   * Deep classification from full HTML content.
   * Call this after fetching the page when meta-classification was uncertain.
   */
  classifyFromContent(
    html: string,
    _url: string,
    _input: PersonaSearchInput,
  ): PageType {
    const $ = cheerio.load(html);
    const scores: ScoreMap = {};
    const add = (type: PageType, pts: number) => { scores[type] = (scores[type] ?? 0) + pts; };

    // Decode charset if page claims windows-1251 (best-effort)
    const bodyText = $('body').text().toLowerCase().replace(/\s+/g, ' ');

    // ── Page title ──────────────────────────────────────────────────────────
    const pageTitle = $('title').text().toLowerCase();
    const h1Text = $('h1').first().text().toLowerCase();

    if (MUNICIPALITY_TEXT_SIGNALS.some(s => pageTitle.includes(s) || h1Text.includes(s))) {
      add('MUNICIPALITY_PAGE', 70);
    }
    if (REGISTRY_TEXT_SIGNALS.some(s => pageTitle.includes(s))) {
      add('OFFICIAL_REGISTRY', 50);
    }

    // ── Contact info density ────────────────────────────────────────────────
    const emails = (bodyText.match(EMAIL_RE) ?? []);
    const phones = (bodyText.match(PHONE_RE) ?? []);
    const uniqueEmails = new Set(emails).size;
    const uniquePhones = new Set(phones).size;

    if (uniqueEmails >= 5 || uniquePhones >= 5) {
      // Many distinct contacts = listing/directory
      add('DIRECTORY_OR_PORTAL', 60);
    } else if (uniqueEmails >= 2 && uniquePhones >= 2) {
      add('DIRECTORY_OR_PORTAL', 30);
    } else if (uniqueEmails === 1 || (uniqueEmails === 0 && uniquePhones === 1)) {
      add('TARGET_ORGANIZATION', 30);
    }

    // ── Directory / registry keywords in body text ──────────────────────────
    if (DIRECTORY_TEXT_SIGNALS.some(s => bodyText.includes(s))) {
      add('DIRECTORY_OR_PORTAL', 50);
    }
    if (REGISTRY_TEXT_SIGNALS.some(s => bodyText.includes(s))) {
      add('OFFICIAL_REGISTRY', 40);
    }

    // ── List / table structures ─────────────────────────────────────────────
    const tableRows = $('table tr').length;
    const listItems = $('ul li, ol li').length;
    if (tableRows >= 8 || listItems >= 10) {
      add('DIRECTORY_OR_PORTAL', 40);
    } else if (tableRows >= 4 || listItems >= 4) {
      add('DIRECTORY_OR_PORTAL', 20);
    }

    // ── Pagination ──────────────────────────────────────────────────────────
    const hasPagination = $('[class*="paginat"], [id*="paginat"], a[href*="page="], a[href*="str="]').length > 0;
    if (hasPagination) add('DIRECTORY_OR_PORTAL', 30);

    // ── News article signals ────────────────────────────────────────────────
    const hasArticleDate = $('time, [class*="date"], [class*="publish"], [class*="posted"]').length > 0;
    const hasArticleTag = $('article, [class*="article"], [class*="post-content"]').length > 0;
    if (hasArticleDate && hasArticleTag) add('NEWS_ARTICLE', 60);

    // ── Single organization signals ─────────────────────────────────────────
    const hasAboutSection = $('[id*="about"], [class*="about"], [id*="contact"], [class*="contact"]').length > 0;
    const singleH1 = $('h1').length === 1;
    if (singleH1 && hasAboutSection) add('TARGET_ORGANIZATION', 40);

    // ── Municipality keywords in body ───────────────────────────────────────
    const municipalityHits = MUNICIPALITY_TEXT_SIGNALS.filter(s => bodyText.includes(s)).length;
    if (municipalityHits >= 2) add('MUNICIPALITY_PAGE', municipalityHits * 20);

    const result = scoreToType(scores);
    const winner = scores[result] ?? 0;
    if (winner < 30) return 'UNKNOWN';
    return result;
  }
}
