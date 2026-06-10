/**
 * Tests for location/address extraction quality filtering.
 *
 * Root causes of the two reported bugs:
 *
 *   Bug 1 — Timeline as address (Yotov Stone):
 *     "2008Construction of our first 1,500 sq.m. Production Facility |
 *      2010Construction of our 660 sq.m. Slab Warehouse"
 *     Source: a <address> element or [class*="address"] element whose developer
 *     misused the class/tag for the company history section.  Strategy 1 accepted
 *     any non-CSS, non-banner text from <address> with no further quality gate.
 *     Strategy 2's fallback took the "shortest line" without checking for timelines.
 *   Fix: looksLikeTimeline() guard added to Strategies 1 and 2 fallback.
 *
 *   Bug 2 — Map-widget labels in address (Cross):
 *     "жк.Младост 2, бул.Андрей Ляпчев бл.261 А Distance: | площад Жеравица Distance:"
 *     Source: Strategy 3 (text scan) correctly detected "бул." as a street indicator,
 *     but the cleanup only stripped trailing [,;.] — not "Distance:" map widget labels.
 *   Fix: cleanAddressArtifacts() applied to all strategy outputs.
 *
 * Run with:  npx ts-node src/services/__tests__/extractLocation.test.ts
 */

import { looksLikeTimeline, cleanAddressArtifacts, extractProfile } from '../extraction';

let passed = 0;
let failed = 0;

function assert(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       got:      ${JSON.stringify(actual)}`);
    console.error(`       expected: ${JSON.stringify(expected)}`);
    failed++;
  }
}

function makePage(
  html: string,
  text = '',
  url = 'https://example-company.bg/',
): Parameters<typeof extractProfile>[0][0] {
  return { url, html, text, emails: [], phones: [], loginProtected: false, logoUrls: [] };
}

// ── looksLikeTimeline unit tests ──────────────────────────────────────────────

console.log('\nlooksLikeTimeline — must return TRUE (timelines / history)');

// Exact reported bug string
assert(
  'year directly concatenated with text — bug report string',
  looksLikeTimeline(
    '2008Construction of our first 1,500 sq.m. Production Facility | 2010Construction of our 660 sq.m. Slab Warehouse',
  ),
  true,
);
assert('2010Expansion (year+letter, no space)',      looksLikeTimeline('2010Expansion of the facility'),        true);
assert('1998Founded (year+letter, no space)',        looksLikeTimeline('1998Founded by the Yotov family'),     true);
assert('multiple years in long text',               looksLikeTimeline('In 2008 we built and in 2015 expanded the factory'), true);
assert('pipe-separated years (milestone list)',      looksLikeTimeline('2010 First plant | 2014 Second plant | 2020 Export'), true);

console.log('\nlooksLikeTimeline — must return FALSE (real addresses)');

// Bulgarian address with жк. / бул.
assert(
  'Bulgarian address жк.Младост + бул. — not timeline',
  looksLikeTimeline('жк.Младост 2, бул.Андрей Ляпчев бл.261 А'),
  false,
);
// Single year in address (founder year, common in footer)
assert('single year in text ≤ 60 chars is OK',      looksLikeTimeline('Sofia 2010, Bulgaria'),                false);
// Postal codes (not in 19xx/20xx range)
assert('postal code 1784 (not year range)',          looksLikeTimeline('1784 Sofia, Bulgaria'),                false);
// Year used as part of a street name: "ул. 19 февруари" — the year in 19xx/20xx range
// but NOT directly adjacent to a letter (there's a space before "февруари").
assert('street name with year prefix — space present', looksLikeTimeline('ул. 19 Февруари 3, Варна'),          false);
// Short text with one year (not long enough for "multiple years" rule)
assert('one year in short text',                    looksLikeTimeline('Founded 2005'),                        false);

// ── cleanAddressArtifacts unit tests ──────────────────────────────────────────

console.log('\ncleanAddressArtifacts — cleanup cases');

// Exact reported bug string
assert(
  'strips Distance: and pipe-separated duplicate — bug report string',
  cleanAddressArtifacts('жк.Младост 2, бул.Андрей Ляпчев бл.261 А Distance: | площад Жеравица Distance:'),
  'жк.Младост 2, бул.Андрей Ляпчев бл.261 А',
);
assert(
  'strips single trailing Distance:',
  cleanAddressArtifacts('ул. Иван Вазов 5, София Distance:'),
  'ул. Иван Вазов 5, София',
);
assert(
  'strips Distance: with value after it',
  cleanAddressArtifacts('Sofia, bul. Vitosha 12 Distance: 3.2 km'),
  'Sofia, bul. Vitosha 12',
);
assert(
  'strips Directions: label',
  cleanAddressArtifacts('Sofia, Bulgaria Directions:'),
  'Sofia, Bulgaria',
);
assert(
  'pipe-only: keeps first segment',
  cleanAddressArtifacts('бул. Сливница 186, София | District Nadezhda'),
  'бул. Сливница 186, София',
);
assert(
  'clean address: no change',
  cleanAddressArtifacts('ул. Иван Вазов 5, 1000 София'),
  'ул. Иван Вазов 5, 1000 София',
);
assert(
  'trailing comma stripped',
  cleanAddressArtifacts('Sofia, Bulgaria,'),
  'Sofia, Bulgaria',
);

// ── Integration: Strategy 1 (<address> element) ───────────────────────────────

console.log('\nStrategy 1 — <address> element');

{
  const profile = extractProfile([makePage(
    '<html><body><address>ул. Иван Вазов 5, 1000 София, България</address></body></html>',
  )]);
  assert(
    'real Bulgarian address in <address> → extracted',
    profile.location,
    'ул. Иван Вазов 5, 1000 София, България',
  );
}

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<address>2008Construction of our first 1,500 sq.m. Production Facility | 2010Construction of our 660 sq.m. Slab Warehouse</address>' +
    '</body></html>',
  )]);
  assert(
    'timeline text in <address> → rejected (location undefined or from fallback)',
    profile.location === undefined || !profile.location.includes('2008'),
    true,
  );
}

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<address>бул. Андрей Ляпчев 261А, София Distance: 5 km</address>' +
    '</body></html>',
  )]);
  assert(
    'address with Distance: in <address> → cleaned',
    profile.location,
    'бул. Андрей Ляпчев 261А, София',
  );
}

// ── Integration: Strategy 2 (class="address") ────────────────────────────────

console.log('\nStrategy 2 — class="address" elements');

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<div class="company-address">' +
        '<span>ул. Пиротска 5</span>' +
        '<span>1000 София</span>' +
      '</div>' +
    '</body></html>',
  )]);
  assert(
    'real address in class="company-address" → extracted (contains street indicator)',
    profile.location?.includes('Пиротска') ?? false,
    true,
  );
}

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<div class="contact-address">' +
        '2008Construction of our first 1,500 sq.m. Production Facility | 2010Construction of our 660 sq.m. Slab Warehouse' +
      '</div>' +
    '</body></html>',
  )]);
  assert(
    'timeline in class="contact-address" → rejected (Strategy 2 fallback guard)',
    profile.location === undefined || !profile.location.includes('2008'),
    true,
  );
}

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<div class="address-block">' +
        'жк.Младост 2, бул.Андрей Ляпчев бл.261 А Distance: | площад Жеравица Distance:' +
      '</div>' +
    '</body></html>',
  )]);
  assert(
    'address + Distance: in class="address-block" → cleaned',
    profile.location,
    'жк.Младост 2, бул.Андрей Ляпчев бл.261 А',
  );
}

// ── Integration: Strategy 3 (text scan) ──────────────────────────────────────

console.log('\nStrategy 3 — text-based scan');

{
  const text = [
    'About us',
    'Our team',
    'жк.Младост 2, бул.Андрей Ляпчев бл.261 А Distance: | площад Жеравица Distance:',
    'Contact us',
  ].join('\n');
  const profile = extractProfile([makePage(
    '<html><head><title>Company</title></head><body></body></html>',
    text,
  )]);
  assert(
    'text scan: Distance: stripped from line with бул.',
    profile.location,
    'жк.Младост 2, бул.Андрей Ляпчев бл.261 А',
  );
}

{
  const text = [
    'History',
    '2008Construction of our first production facility',
    'Our address: ул. Иван Вазов 5, 1000 София',
  ].join('\n');
  const profile = extractProfile([makePage(
    '<html><head><title>Company</title></head><body></body></html>',
    text,
  )]);
  // Strategy 3 already filters the timeline line (no STREET_INDICATOR match).
  // The real address line matches via "address:" label.
  assert(
    'text scan: timeline line skipped, real address line extracted',
    profile.location?.includes('Вазов') ?? false,
    true,
  );
}

{
  const text = [
    'Main Office',
    'bul. Vitosha 12, Sofia Distance: | Sofia City Center Distance:',
  ].join('\n');
  const profile = extractProfile([makePage(
    '<html><head><title>Company</title></head><body></body></html>',
    text,
  )]);
  assert(
    'text scan: bul. match, Distance: and pipe fragment stripped',
    profile.location,
    'bul. Vitosha 12, Sofia',
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
