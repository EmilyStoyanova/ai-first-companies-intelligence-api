// Login-page fallback enrichment.
// When a site's homepage is a login wall and normal extraction fails,
// this pipeline identifies the company from its visible branding/logo
// and enriches the profile through secondary web search.

import { CrawledPage } from '../worker/crawl';
import { runLogoOcr } from './logoOcr';
import { rawSearch, SearchResult } from '../lib/search';
import { normalizeSocialUrl } from './extraction';

export interface LoginFallbackResult {
  loginProtected: true;
  companyNameFromLogo?: string;
  sloganFromLogo?: string;
  logoNameConfidence: number;
  logoSourceUrl?: string;
  enrichedName?: string;
  enrichedDescription?: string;
  enrichedSocialLinks: Record<string, string>;
  scoreBonus: number;
}

// Social platforms to discover via secondary search
const SOCIAL_PLATFORMS = ['linkedin', 'facebook', 'instagram', 'youtube'] as const;

async function discoverSocialProfiles(
  name: string,
  domain: string,
): Promise<Record<string, string>> {
  const found: Record<string, string> = {};

  for (const platform of SOCIAL_PLATFORMS) {
    const label = platform === 'linkedin' ? 'LinkedIn company' : platform;
    try {
      const results: SearchResult[] = await rawSearch(`"${name}" ${label}`);
      for (const r of results.slice(0, 5)) {
        if (found[platform]) break;
        const normalized = normalizeSocialUrl(r.url);
        if (normalized?.platform !== platform) continue;

        // Confidence: the social page slug or title must relate to the company name
        const slug       = r.url.split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
        const titleLower = (r.title ?? '').toLowerCase();
        const nameLower  = name.toLowerCase();
        const nameWords  = nameLower.split(/\s+/).filter((w) => w.length > 3);
        const domainBase = domain.split('.')[0].toLowerCase();

        const confident =
          slug.includes(nameLower.replace(/\s+/g, '')) ||
          slug.includes(domainBase) ||
          nameWords.some((w) => slug.includes(w) || titleLower.includes(w)) ||
          titleLower.includes(nameLower);

        if (confident) found[platform] = normalized.url;
      }
    } catch { /* non-critical */ }
  }

  return found;
}

async function searchForDescription(name: string, domain: string): Promise<string | undefined> {
  const queries = [
    `"${name}" company about`,
    `"${name}" Bulgaria`,
  ];

  for (const query of queries) {
    try {
      const results: SearchResult[] = await rawSearch(query);
      for (const r of results.slice(0, 3)) {
        if (!r.snippet || r.snippet.length < 30) continue;
        const snippetLower = r.snippet.toLowerCase();
        const nameLower    = name.toLowerCase();
        const domainBase   = domain.split('.')[0].toLowerCase();

        const relevant =
          r.url.includes(domain) ||
          snippetLower.includes(nameLower) ||
          (r.title ?? '').toLowerCase().includes(nameLower) ||
          snippetLower.includes(domainBase);

        if (relevant) return r.snippet;
      }
    } catch { /* non-critical */ }
  }

  return undefined;
}

export async function runLoginFallbackEnrichment(
  pages: CrawledPage[],
  domain: string,
): Promise<LoginFallbackResult> {
  const result: LoginFallbackResult = {
    loginProtected: true,
    logoNameConfidence: 0,
    enrichedSocialLinks: {},
    scoreBonus: 0,
  };

  // Collect all logo URL candidates from all crawled pages
  const allLogoUrls: string[] = [];
  for (const page of pages) {
    for (const url of page.logoUrls) {
      if (!allLogoUrls.includes(url)) allLogoUrls.push(url);
    }
  }

  if (allLogoUrls.length === 0) {
    console.log(`[login-fallback] ${domain} — no logo URLs found`);
    return result;
  }

  // Try OCR on each logo candidate in priority order until we get a confident result
  for (const logoUrl of allLogoUrls.slice(0, 5)) {
    console.log(`[login-fallback] ${domain} — trying OCR on ${logoUrl}`);
    const ocr = await runLogoOcr(logoUrl);

    if (ocr && ocr.logoNameConfidence > 0 && ocr.companyNameFromLogo) {
      result.companyNameFromLogo = ocr.companyNameFromLogo;
      result.sloganFromLogo      = ocr.sloganFromLogo;
      result.logoNameConfidence  = ocr.logoNameConfidence;
      result.logoSourceUrl       = ocr.logoSourceUrl;
      console.log(
        `[login-fallback] ${domain} — identified "${ocr.companyNameFromLogo}" ` +
        `(confidence: ${ocr.logoNameConfidence}) from logo`,
      );
      break;
    }
  }

  if (!result.companyNameFromLogo) {
    console.log(`[login-fallback] ${domain} — OCR found no usable company name`);
    return result;
  }

  result.enrichedName = result.companyNameFromLogo;
  result.scoreBonus += 20; // equivalent to FIELD_WEIGHTS.name

  // Secondary: search for a description using the OCR name
  try {
    const desc = await searchForDescription(result.companyNameFromLogo, domain);
    if (desc) {
      result.enrichedDescription = desc;
      result.scoreBonus += 10; // partial description credit (not full 20 since it's search-derived)
    }
  } catch { /* non-critical */ }

  // Social profile discovery
  try {
    const social = await discoverSocialProfiles(result.companyNameFromLogo, domain);
    result.enrichedSocialLinks = social;
    if (Object.keys(social).length > 0) {
      result.scoreBonus += 5; // FIELD_WEIGHTS.socialLinks
      console.log(`[login-fallback] ${domain} — social profiles found:`, social);
    }
  } catch { /* non-critical */ }

  return result;
}
