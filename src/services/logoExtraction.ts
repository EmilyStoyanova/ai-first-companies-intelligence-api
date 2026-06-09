import * as cheerio from 'cheerio';

function resolveUrl(href: string, baseUrl: string): string | null {
  if (!href || href.startsWith('data:')) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

// Returns de-duplicated logo URL candidates sorted by descending priority.
// Priority 1 = highest confidence (explicit "logo" attribute), 5 = lowest.
export function extractLogoUrls(html: string, baseUrl: string): string[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const candidates: Array<{ url: string; priority: number }> = [];

  function add(href: string | undefined, priority: number) {
    if (!href) return;
    const resolved = resolveUrl(href, baseUrl);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push({ url: resolved, priority });
  }

  // Priority 1: img whose src, alt, class, id, or title contains "logo"
  $('img').each((_i, el) => {
    const src  = $(el).attr('src')   ?? '';
    const alt  = $(el).attr('alt')   ?? '';
    const cls  = $(el).attr('class') ?? '';
    const id   = $(el).attr('id')    ?? '';
    const title = $(el).attr('title') ?? '';
    if (/logo/i.test(src + alt + cls + id + title)) add(src, 1);
  });

  // Priority 2: images inside elements whose class/id contains "logo"
  $('[class*="logo"] img, [id*="logo"] img').each((_i, el) => add($(el).attr('src'), 2));

  // Priority 3: images directly inside <header> or known header containers
  $('header img, .header img, #header img, .site-header img, .top-bar img').each(
    (_i, el) => add($(el).attr('src'), 3),
  );

  // Priority 4: OpenGraph / Twitter card image (company social sharing image often = logo)
  add($('meta[property="og:image"]').attr('content'), 4);
  add($('meta[name="twitter:image"]').attr('content'), 4);

  // Priority 5: any SVG image (many modern sites use linked SVGs for logos)
  $('img[src$=".svg"]').each((_i, el) => add($(el).attr('src'), 5));

  return candidates
    .sort((a, b) => a.priority - b.priority)
    .map((c) => c.url)
    .slice(0, 5);
}

// Attempt to extract a company name hint from the logo filename alone.
// Used as a low-confidence fallback when OCR is unavailable or inconclusive.
export function extractNameFromLogoFilename(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').pop() ?? '';
    const stem = filename
      .replace(/\.(svg|png|jpg|jpeg|gif|webp|avif)(\?.*)?$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b(logo|icon|brand|header|site|img|image|banner)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (stem.length < 2 || stem.length > 50) return null;
    if (/^\s*\d+\s*$/.test(stem)) return null;
    // Must contain at least one letter
    if (!/[a-zA-ZЀ-ӿ]/.test(stem)) return null;

    // Title-case it for readability
    return stem.replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return null;
  }
}
