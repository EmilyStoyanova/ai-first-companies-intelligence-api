import * as cheerio from 'cheerio';
import type { DiscoverySourceResult, PersonaSearchInput } from './types';

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
// Matches Bulgarian phones with optional spaces/dashes between digit groups
const PHONE_RE = /0[789]\d{2}[\s\-.]?\d{3}[\s\-.]?\d{3}|(?:\+359|00359)\d{2}[\s\-.]?\d{3}[\s\-.]?\d{3}|\d{3,5}[\s\-]\d{3,6}/;
// Matches Bulgarian address patterns: ул., бул., пл., кв., жк
const ADDRESS_RE = /(?:ул\.|бул\.|пл\.|кв\.|жк|ж\.к\.)\s+[А-Яа-я\w\s"«»„"№]+(?:№|N|n)?\s*\d*/;

// Common Bulgarian org type abbreviations for name validation
const ORG_NAME_PREFIXES = [
  'дг', 'цдг', 'дс', 'дя', 'одз', 'ддуи', 'сг', 'сцг', 'ну', 'оу', 'ог',
  'суе', 'су', 'пмг', 'пг', 'пу', 'гимназия', 'училище', 'детска градина',
  'детски ясли', 'яслена', 'ясла', 'детско', 'цсри', 'дцср', 'апц', 'дрсз',
  'болница', 'поликлиника', 'аптека', 'читалище', 'нчх', 'община',
  'хотел', 'хотелски', 'ресторант',
];

function extractDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function findEmail(text: string): string | undefined {
  return text.match(EMAIL_RE)?.[0];
}

function findPhone(text: string): string | undefined {
  return text.match(PHONE_RE)?.[0];
}

function findAddress(text: string): string | undefined {
  return text.match(ADDRESS_RE)?.[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findWebsiteLink($el: cheerio.Cheerio<any>, $: cheerio.CheerioAPI): string | undefined {
  const links = $el.find('a[href]');
  for (let i = 0; i < links.length; i++) {
    const href = $(links[i]).attr('href') ?? '';
    if (href.startsWith('http') && !href.includes('facebook') && !href.includes('google')) {
      return href;
    }
  }
  return undefined;
}

function looksLikeOrgName(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return ORG_NAME_PREFIXES.some(p => lower.startsWith(p));
}

function matchesPersonaKeyword(text: string, persona: string): boolean {
  const personaWords = persona.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const textLower = text.toLowerCase();
  return personaWords.some(w => textLower.includes(w));
}

function buildResult(
  name: string,
  text: string,
  websiteUrl: string | undefined,
  sourceUrl: string,
  input: PersonaSearchInput,
): DiscoverySourceResult {
  const email = findEmail(text);
  const phone = findPhone(text);
  const address = findAddress(text);
  const domain = websiteUrl ? extractDomain(websiteUrl) : undefined;

  // Confidence: each signal adds points
  let confidence = 30; // baseline for extracted orgs
  if (email) confidence += 20;
  if (phone) confidence += 15;
  if (address) confidence += 10;
  if (domain) confidence += 15;
  if (matchesPersonaKeyword(name, input.persona)) confidence += 10;

  return {
    name,
    domain,
    websiteUrl,
    email,
    phone,
    address,
    sourceUrl: websiteUrl ?? sourceUrl,
    sourceType: 'municipality',
    confidence: Math.min(confidence, 100),
    pageType: 'TARGET_ORGANIZATION',
    extractedFromUrl: sourceUrl,
    title: name,
  };
}

/**
 * Extracts a list of organizations from a municipality or directory page.
 *
 * Tries four strategies in order:
 *  1. Table extraction — rows in <table> elements
 *  2. Heading-paragraph extraction — <h3>/<h4> followed by contact details
 *  3. List extraction — <li> elements with org-like headings
 *  4. Link extraction — fallback: named links that look like org websites
 */
export class OrganizationExtractor {
  async extractOrganizations(
    html: string,
    sourceUrl: string,
    input: PersonaSearchInput,
  ): Promise<DiscoverySourceResult[]> {
    const $ = cheerio.load(html);
    const results: DiscoverySourceResult[] = [];

    results.push(...this.extractFromTable($, sourceUrl, input));
    results.push(...this.extractFromHeadings($, sourceUrl, input));
    results.push(...this.extractFromList($, sourceUrl, input));

    // Fallback: if nothing found, try link harvesting
    if (results.length === 0) {
      results.push(...this.extractFromLinks($, sourceUrl, input));
    }

    // Deduplicate by name within this page
    const seen = new Set<string>();
    return results.filter(r => {
      const key = r.name?.toLowerCase().trim() ?? r.domain ?? r.sourceUrl;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private extractFromTable(
    $: cheerio.CheerioAPI,
    sourceUrl: string,
    input: PersonaSearchInput,
  ): DiscoverySourceResult[] {
    const results: DiscoverySourceResult[] = [];

    $('table').each((_, table) => {
      const rows = $(table).find('tr');
      if (rows.length < 3) return; // need at least a header + 2 data rows

      // Detect header row to understand column positions
      let nameCol = 0;
      const headerRow = rows.first();
      const headers = headerRow.find('th, td').map((_, el) => $(el).text().toLowerCase()).get();
      const nameColIdx = headers.findIndex(h => h.includes('наименование') || h.includes('naziv') || h.includes('наим') || h.includes('name') || h.includes('детска') || h.includes('учили'));
      if (nameColIdx >= 0) nameCol = nameColIdx;

      rows.slice(1).each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length === 0) return;

        const nameCell = cells.eq(nameCol);
        const rowEl = $(row);
        const rowText = rowEl.text();
        const name = nameCell.text().trim();

        if (!name || name.length < 3) return;
        if (!looksLikeOrgName(name) && !matchesPersonaKeyword(name, input.persona)) return;

        const websiteUrl = findWebsiteLink(rowEl, $);
        results.push(buildResult(name, rowText, websiteUrl, sourceUrl, input));
      });
    });

    return results;
  }

  private extractFromHeadings(
    $: cheerio.CheerioAPI,
    sourceUrl: string,
    input: PersonaSearchInput,
  ): DiscoverySourceResult[] {
    const results: DiscoverySourceResult[] = [];

    // Find h3/h4/h5 elements that look like org names
    // Skip h2 — it is typically a page/section title, not an individual org name
    $('h3, h4, h5').each((_, heading) => {
      const headingEl = $(heading);
      const name = headingEl.text().trim();

      if (!name || name.length < 3 || name.length > 120) return;
      if (!looksLikeOrgName(name) && !matchesPersonaKeyword(name, input.persona)) return;

      // Collect sibling text until next heading
      let contextText = name;
      let websiteUrl: string | undefined;
      let sibling = headingEl.next();

      for (let i = 0; i < 6; i++) {
        if (!sibling.length) break;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tagName = sibling[0].type === 'tag' ? (sibling[0] as any).tagName?.toLowerCase() ?? '' : '';
        if (['h2', 'h3', 'h4', 'h5', 'h1'].includes(tagName)) break;

        contextText += ' ' + sibling.text();
        if (!websiteUrl) websiteUrl = findWebsiteLink(sibling, $);
        sibling = sibling.next();
      }

      if (!findEmail(contextText) && !findPhone(contextText) && !websiteUrl) return;
      results.push(buildResult(name, contextText, websiteUrl, sourceUrl, input));
    });

    return results;
  }

  private extractFromList(
    $: cheerio.CheerioAPI,
    sourceUrl: string,
    input: PersonaSearchInput,
  ): DiscoverySourceResult[] {
    const results: DiscoverySourceResult[] = [];

    $('ul, ol').each((_, list) => {
      const items = $(list).children('li');
      if (items.length < 2) return;

      // Check if a majority of list items look like org entries
      let orgLikeCount = 0;
      items.each((_, li) => {
        const text = $(li).text().trim();
        if (looksLikeOrgName(text) || matchesPersonaKeyword(text, input.persona)) orgLikeCount++;
      });
      if (orgLikeCount < Math.floor(items.length * 0.4)) return;

      items.each((_, li) => {
        const liEl = $(li);
        const liText = liEl.text().trim();

        // Try to extract name from first strong/b/heading child, or first line
        let name =
          liEl.find('strong, b, em').first().text().trim() ||
          liText.split('\n')[0].trim();

        if (!name || name.length < 3) return;
        // Trim the name to the first line if it's too long
        if (name.length > 120) name = name.slice(0, 120);
        if (!looksLikeOrgName(name) && !matchesPersonaKeyword(name, input.persona)) return;

        const websiteUrl = findWebsiteLink(liEl, $);
        results.push(buildResult(name, liText, websiteUrl, sourceUrl, input));
      });
    });

    return results;
  }

  private extractFromLinks(
    $: cheerio.CheerioAPI,
    sourceUrl: string,
    input: PersonaSearchInput,
  ): DiscoverySourceResult[] {
    const results: DiscoverySourceResult[] = [];

    $('a[href^="http"]').each((_, el) => {
      const linkEl = $(el);
      const href = linkEl.attr('href') ?? '';
      const text = linkEl.text().trim();

      if (!text || text.length < 3) return;
      if (!looksLikeOrgName(text) && !matchesPersonaKeyword(text, input.persona)) return;

      const domain = extractDomain(href);
      if (!domain) return;

      // Skip if link goes back to the same municipality/source domain
      const sourceDomain = extractDomain(sourceUrl);
      if (sourceDomain && domain === sourceDomain) return;

      results.push({
        name: text,
        domain,
        websiteUrl: href,
        sourceUrl: href,
        sourceType: 'directory',
        confidence: 40,
        pageType: 'TARGET_ORGANIZATION',
        extractedFromUrl: sourceUrl,
        title: text,
      });
    });

    return results;
  }
}
