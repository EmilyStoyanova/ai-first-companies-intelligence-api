import * as cheerio from 'cheerio';
import { CrawledPage } from '../worker/crawl';

export interface ExtractedProfile {
  name?: string;
  description?: string;
  location?: string;
  emails: string[];
  phones: string[];
  services: string[];
  team: string[];
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

function extractCompanyName(pages: CrawledPage[]): string | undefined {
  const homepage = pages[0];
  if (!homepage?.html) return undefined;

  const $ = cheerio.load(homepage.html);

  // Try <title>
  const title = $('title').text().trim();
  if (title) {
    // Strip common suffixes like " - Home", " | Services"
    return title.split(/[|\-–]/)[0].trim();
  }

  // Try og:site_name
  const ogSite = $('meta[property="og:site_name"]').attr('content');
  if (ogSite) return ogSite.trim();

  return undefined;
}

function extractDescription(pages: CrawledPage[]): string | undefined {
  const homepage = pages[0];
  if (!homepage?.html) return undefined;

  const $ = cheerio.load(homepage.html);

  const metaDesc = $('meta[name="description"]').attr('content');
  if (metaDesc && metaDesc.length > 20) return metaDesc.trim();

  const ogDesc = $('meta[property="og:description"]').attr('content');
  if (ogDesc && ogDesc.length > 20) return ogDesc.trim();

  // Fall back to first substantial paragraph
  let fallback = '';
  $('p').each((_i, el) => {
    const t = $(el).text().trim();
    if (!fallback && t.length > 60) fallback = t;
  });

  return fallback || undefined;
}

function extractLocation(pages: CrawledPage[]): string | undefined {
  // Look for common address patterns across all pages text
  const combined = pages.map((p) => p.text).join('\n');

  // Simple heuristic: lines containing "Address", city+zip patterns, etc.
  const ADDRESS_RE = /\b(\d{1,5}\s+\w[\w\s,.-]{5,60}(?:Street|St|Avenue|Ave|Blvd|Road|Rd|Lane|Ln|Drive|Dr|Plaza|Square|Sq)[\w\s,.-]{0,40})/i;
  const match = combined.match(ADDRESS_RE);
  return match?.[0]?.trim();
}

function extractServices(pages: CrawledPage[]): string[] {
  const servicePage = pages.find(
    (p) => p.url.includes('/service') || p.url.includes('/solution')
  );
  const source = servicePage ?? pages[0];
  if (!source?.html) return [];

  const $ = cheerio.load(source.html);
  const items: string[] = [];

  // Try lists under headings that sound like services
  $('h2, h3').each((_i, el) => {
    const heading = $(el).text().toLowerCase();
    if (heading.includes('service') || heading.includes('solution') || heading.includes('what we')) {
      $(el).next('ul, ol').find('li').each((_j, li) => {
        const t = $(li).text().trim();
        if (t.length > 2 && t.length < 100) items.push(t);
      });
    }
  });

  return [...new Set(items)].slice(0, 20);
}

function extractTeam(pages: CrawledPage[]): string[] {
  const teamPage = pages.find((p) => p.url.includes('/team') || p.url.includes('/about'));
  if (!teamPage?.html) return [];

  const $ = cheerio.load(teamPage.html);
  const members: string[] = [];

  // Common patterns: headings inside team cards
  $('[class*="team"] h3, [class*="team"] h4, [class*="member"] h3, [class*="member"] h4').each(
    (_i, el) => {
      const name = $(el).text().trim();
      if (name.length > 2 && name.length < 60) members.push(name);
    }
  );

  return [...new Set(members)].slice(0, 50);
}

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
  if (profile.name) score += FIELD_WEIGHTS.name;
  if (profile.description) score += FIELD_WEIGHTS.description;
  if (profile.location) score += FIELD_WEIGHTS.location;
  if (profile.emails.length > 0) score += FIELD_WEIGHTS.emails;
  if (profile.phones.length > 0) score += FIELD_WEIGHTS.phones;
  if (profile.services.length > 0) score += FIELD_WEIGHTS.services;
  if (profile.team.length > 0) score += FIELD_WEIGHTS.team;
  if (profile.history) score += FIELD_WEIGHTS.history;
  if (Object.keys(profile.socialLinks).length > 0) score += FIELD_WEIGHTS.socialLinks;
  return score;
}

export function extractProfile(pages: CrawledPage[]): ExtractedProfile {
  const allEmails = [...new Set(pages.flatMap((p) => p.emails))];
  const allPhones = [...new Set(pages.flatMap((p) => p.phones))];

  const base = {
    name: extractCompanyName(pages),
    description: extractDescription(pages),
    location: extractLocation(pages),
    emails: allEmails,
    phones: allPhones,
    services: extractServices(pages),
    team: extractTeam(pages),
    history: extractHistory(pages),
    socialLinks: extractSocialLinks(pages),
  };

  return {
    ...base,
    completionScore: computeCompletionScore(base),
  };
}
