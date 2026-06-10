/**
 * Tests for history extraction quality filtering.
 *
 * Root cause of the "OUR MISSION STATEMENT" bug (Yotov Stone):
 *   extractHistory matched any heading containing "about" and then took the raw
 *   text of the immediate next <p> sibling with zero content validation.
 *   A <p>OUR MISSION STATEMENT</p> that follows an <h2>About Us</h2> was stored
 *   verbatim as the company history.  Additionally, the `history` variable was
 *   overwritten on every matching heading (last match wins), so a late
 *   mission/vision heading could clobber any earlier valid content.
 *
 * Fix:
 *   1. HISTORY_DENY_HEADING_RE — rejects "Our Mission", "Mission Statement",
 *      "Vision", "Values", "About Us", "About" etc.
 *   2. HISTORY_HEADING_RE — only history-specific headings trigger Strategy 1.
 *   3. looksLikeHistoryText() — content quality gate: min 30 chars + founding
 *      signal (founded/established/since/основана/история/year context).
 *   4. collectFollowingText() — gathers multiple sibling paragraphs (not just
 *      the immediate next <p>), stopping at the next heading element.
 *   5. Strategy 2 — on about/history-URL pages, scan all <p> elements directly
 *      even when no suitable heading is present.
 *
 * Run with:  npx ts-node src/services/__tests__/extractHistory.test.ts
 */

import { looksLikeHistoryText, extractProfile } from '../extraction';

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
  url = 'https://yotovstone.bg/',
): Parameters<typeof extractProfile>[0][0] {
  return { url, html, text: '', emails: [], phones: [], loginProtected: false, logoUrls: [] };
}

// ── looksLikeHistoryText unit tests ──────────────────────────────────────────

console.log('\nlooksLikeHistoryText — must return TRUE (genuine history content)');

assert(
  '"founded in 1985" — founding word present',
  looksLikeHistoryText('The company was founded in 1985 by the Yotov family.'),
  true,
);
assert(
  '"established" keyword',
  looksLikeHistoryText('Established in Sofia in 1998, we have grown into a regional leader.'),
  true,
);
assert(
  '"since YYYY" pattern',
  looksLikeHistoryText('We have been serving our customers since 1992.'),
  true,
);
assert(
  '"in YYYY" with context',
  looksLikeHistoryText('In 2003 we opened our second production facility.'),
  true,
);
assert(
  '"started" keyword',
  looksLikeHistoryText('The business started as a small family workshop in 1975.'),
  true,
);
assert(
  '"launched" keyword',
  looksLikeHistoryText('We launched our first product line in 2001 and have expanded ever since.'),
  true,
);
assert(
  'Bulgarian "основана" — founding word',
  looksLikeHistoryText('Компанията е основана в 2005 г. от инженери с опит в машиностроенето.'),
  true,
);
assert(
  'Bulgarian "създадена"',
  looksLikeHistoryText('Фирмата е създадена с цел предоставяне на висококачествени услуги.'),
  true,
);
assert(
  'Bulgarian year marker "2008 г."',
  looksLikeHistoryText('В 2008 г. открихме нашия първи производствен обект с площ 1500 кв.м.'),
  true,
);
assert(
  'Bulgarian "история" keyword',
  looksLikeHistoryText('Историята на нашата фирма започва преди повече от 20 години.'),
  true,
);
assert(
  '"от 1998" (Bulgarian since-pattern)',
  looksLikeHistoryText('Работим в сферата на строителството от 1998 г. и имаме над 500 проекта.'),
  true,
);

console.log('\nlooksLikeHistoryText — must return FALSE (not history content)');

// Exact bug report string — must be rejected
assert(
  '"OUR MISSION STATEMENT" — too short, no history signals',
  looksLikeHistoryText('OUR MISSION STATEMENT'),
  false,
);
assert(
  'Generic mission text without founding signals',
  looksLikeHistoryText('We believe in quality, innovation and customer satisfaction.'),
  false,
);
assert(
  'Values statement with no history markers',
  looksLikeHistoryText('Our core values are integrity, teamwork and continuous improvement.'),
  false,
);
assert(
  'Too short (< 30 chars)',
  looksLikeHistoryText('Founded'),
  false,
);
assert(
  'Empty string',
  looksLikeHistoryText(''),
  false,
);
assert(
  'Vision statement',
  looksLikeHistoryText('Our vision is to be the leading provider of stone products in the Balkans.'),
  false,
);

// ── Integration: Yotov Stone bug scenario ────────────────────────────────────

console.log('\nIntegration — Yotov Stone bug: "OUR MISSION STATEMENT" must not become history');

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>About Yotov Stone</h2>' +
      '<p>OUR MISSION STATEMENT</p>' +
      '<p>We believe in delivering quality stone products.</p>' +
    '</body></html>',
    'https://yotovstone.bg/about',
  )]);
  assert(
    'history is undefined — "OUR MISSION STATEMENT" rejected (too short, no signals)',
    profile.history,
    undefined,
  );
}

// ── Integration: mission/vision/values headings rejected ─────────────────────

console.log('\nIntegration — generic headings must not trigger history extraction');

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>Our Mission</h2>' +
      '<p>We are committed to excellence in every project we undertake.</p>' +
    '</body></html>',
    'https://example.bg/about',
  )]);
  assert('"Our Mission" heading rejected', profile.history, undefined);
}

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>Mission Statement</h2>' +
      '<p>Our mission is to build lasting relationships with our customers.</p>' +
    '</body></html>',
    'https://example.bg/about',
  )]);
  assert('"Mission Statement" heading rejected', profile.history, undefined);
}

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>Vision</h2>' +
      '<p>We envision a future where our products are known globally.</p>' +
    '</body></html>',
    'https://example.bg/about',
  )]);
  assert('"Vision" heading rejected', profile.history, undefined);
}

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h3>Values</h3>' +
      '<p>Integrity, teamwork and respect form the foundation of our culture.</p>' +
    '</body></html>',
    'https://example.bg/about',
  )]);
  assert('"Values" heading rejected', profile.history, undefined);
}

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>About Us</h2>' +
      '<p>OUR MISSION STATEMENT</p>' +
    '</body></html>',
    'https://example.bg/about',
  )]);
  assert('"About Us" heading rejected', profile.history, undefined);
}

// ── Integration: valid history extracted ────────────────────────────────────

console.log('\nIntegration — valid history content must be extracted');

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>Our History</h2>' +
      '<p>The company was founded in 1985 by Ivan Yotov in the town of Vratsa. ' +
         'Over the following decades it grew into one of the leading stone processors in Bulgaria.</p>' +
    '</body></html>',
    'https://yotovstone.bg/about',
  )]);
  assert(
    '"Our History" heading + founding paragraph → extracted',
    profile.history?.includes('1985') ?? false,
    true,
  );
}

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>Company Story</h2>' +
      '<p>Established in Sofia in 1998, we started as a small workshop and have grown into a regional leader.</p>' +
    '</body></html>',
    'https://example.bg/about',
  )]);
  assert(
    '"Company Story" heading + established paragraph → extracted',
    profile.history?.includes('1998') ?? false,
    true,
  );
}

{
  // Strategy 2: no history heading but about-URL page contains history paragraph
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>About Us</h2>' +
      '<p>We believe in quality stone products.</p>' +
      '<p>Our family business was founded in 1985 in Vratsa. ' +
         'Since then we have served over 1,000 customers across Bulgaria.</p>' +
    '</body></html>',
    'https://yotovstone.bg/about',
  )]);
  assert(
    'About page — Strategy 2 paragraph scan finds history despite generic heading',
    profile.history?.includes('1985') ?? false,
    true,
  );
}

{
  // Bulgarian history on about page — no English heading
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>История</h2>' +
      '<p>Компанията е основана в 1992 г. от Иван Йотов. ' +
         'Днес разполагаме с над 50 служители и 3 производствени обекта.</p>' +
    '</body></html>',
    'https://yotovstone.bg/about',
  )]);
  assert(
    '"История" heading (Bulgarian) + founding paragraph → extracted',
    profile.history?.includes('1992') ?? false,
    true,
  );
}

{
  // Multiple headings — only the history one should produce content
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>Our Mission</h2>' +
      '<p>We are committed to sustainable stone production.</p>' +
      '<h2>Our History</h2>' +
      '<p>Founded in 1985 by Ivan Yotov, we have grown from a small quarry operation ' +
         'into the largest stone processor in the Vratsa region.</p>' +
      '<h2>Values</h2>' +
      '<p>Quality, reliability and customer focus.</p>' +
    '</body></html>',
    'https://yotovstone.bg/about',
  )]);
  assert(
    'Multiple headings: only "Our History" produces history content',
    profile.history?.includes('1985') ?? false,
    true,
  );
  assert(
    'Mission and values text not stored in history',
    profile.history?.toLowerCase().includes('committed') ?? false,
    false,
  );
}

{
  // Non-about-URL page with history heading → Strategy 1 still works
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<section>' +
        '<h2>Our Story</h2>' +
        '<p>Since 2001 we have been providing transport services across the Balkans.</p>' +
      '</section>' +
    '</body></html>',
    'https://tashev-trans.com/',
  )]);
  assert(
    'Non-about URL: history heading on homepage → Strategy 1 extracts it',
    profile.history?.includes('2001') ?? false,
    true,
  );
}

{
  // Only mission/vision content on about page → history undefined
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>About Us</h2>' +
      '<p>We are a leading stone processing company.</p>' +
      '<h3>Our Mission</h3>' +
      '<p>To deliver quality products to every customer.</p>' +
      '<h3>Our Vision</h3>' +
      '<p>To be the most trusted name in stone.</p>' +
    '</body></html>',
    'https://example.bg/about',
  )]);
  assert(
    'About page with only mission/vision — history undefined',
    profile.history,
    undefined,
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
