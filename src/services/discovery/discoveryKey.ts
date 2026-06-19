/**
 * Builds a normalized cache key for persona discovery searches.
 *
 * Key format: "<persona>|<location>|<keywords>"
 * Used to detect repeat searches within the 30-day freshness window
 * so we can skip expensive Serper/Groq calls.
 */
export function buildDiscoveryKey(
  persona: string,
  location: string,
  keywords?: string,
): string {
  return [
    normalizeText(persona),
    normalizeLocation(location),
    normalizeKeywords(keywords),
  ].join('|');
}

function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeLocation(location: string): string {
  return normalizeText(location)
    // Strip leading city prefix: "гр.", "гр ", "град " — "гр. Враца" == "Враца"
    .replace(/^(гр\.|гр |град )/, '')
    .trim();
}

function normalizeKeywords(keywords?: string): string {
  if (!keywords?.trim()) return '';
  return keywords
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(' ')
    .sort()
    .join(' ');
}
