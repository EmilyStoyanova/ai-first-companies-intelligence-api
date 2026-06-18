// Tracking parameters that carry no identity for a raw profile URL.
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', '_ga', 'ref',
];

/**
 * Produces a canonical form of a crawled page URL for use as a dedup key.
 *
 * Rules applied:
 *  - protocol normalised to https
 *  - hostname lowercased; leading www. stripped
 *  - default ports (80, 443) removed
 *  - tracking query params removed
 *  - trailing slash stripped from pathname (so /contact/ ≡ /contact)
 *  - fragment (#…) removed
 */
export function normalizeRawProfileUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.protocol = 'https:';
    let host = url.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    url.hostname = host;
    if (url.port === '80' || url.port === '443') url.port = '';
    for (const p of TRACKING_PARAMS) url.searchParams.delete(p);
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }
    url.hash = '';
    return url.toString();
  } catch {
    return raw.trim().toLowerCase().replace(/\/$/, '');
  }
}

/**
 * Extracts and normalises the hostname from a URL or bare domain.
 * Strips protocol, www, ports, and paths.
 */
export function normalizeDomain(raw: string): string {
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    let host = url.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host;
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  }
}
