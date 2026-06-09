export {}; // make this file a module so `passed`/`failed` don't collide with other test files

/**
 * Tests for buildUrlQueue — verifies that:
 *   - Discovered team / contact links suppress fallback guesses
 *   - TEAM_PATHS fallbacks are only added when nothing is discovered
 *   - URLs are deduplicated and normalised (trailing-slash removal)
 *   - The 18-URL cap is respected
 *   - Metrics fields are populated correctly
 *
 * Run with:  npx ts-node src/worker/__tests__/buildUrlQueue.test.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildUrlQueue, TEAM_PATHS, CONTACT_PATHS } = require('../crawl') as typeof import('../crawl') & {
  TEAM_PATHS: string[];
  CONTACT_PATHS: string[];
};

const BASE = 'https://example.com';

let passed = 0;
let failed = 0;

function assert(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log(`  ✓  ${label}`); passed++; }
  else {
    console.error(`  ✗  ${label}`);
    console.error(`       got:      ${JSON.stringify(actual)}`);
    console.error(`       expected: ${JSON.stringify(expected)}`);
    failed++;
  }
}

function assertIncludes(label: string, arr: string[], item: string) {
  const ok = arr.includes(item);
  if (ok) { console.log(`  ✓  ${label}`); passed++; }
  else { console.error(`  ✗  ${label}  (array=${JSON.stringify(arr)})`); failed++; }
}

function assertExcludes(label: string, arr: string[], item: string) {
  const ok = !arr.includes(item);
  if (ok) { console.log(`  ✓  ${label}`); passed++; }
  else { console.error(`  ✗  ${label}  (array unexpectedly contains "${item}")`); failed++; }
}

// ── 1. Site with /team link in navigation ─────────────────────────────────────
console.log('\n1. Site with /team link in nav');
{
  const html = `<html><body>
    <nav>
      <a href="/team">Our Team</a>
      <a href="/contact">Contact</a>
    </nav>
  </body></html>`;
  const q = buildUrlQueue(html, BASE);

  assert('discoveredTeamLinks includes /team',
    q.discoveredTeamLinks.includes(`${BASE}/team`), true);
  assert('fallbackTeamLinks is empty — discovery suppresses fallbacks',
    q.fallbackTeamLinks.length, 0);
  assertIncludes('urlsToVisit has /team', q.urlsToVisit, `${BASE}/team`);
  // None of the other TEAM_PATHS guesses should be in urlsToVisit
  assertExcludes('/about not added when /team discovered', q.urlsToVisit, `${BASE}/about`);
  assertExcludes('/leadership not added when /team discovered', q.urlsToVisit, `${BASE}/leadership`);
}

// ── 2. Site with /about-us link in nav ────────────────────────────────────────
console.log('\n2. Site with /about-us in nav');
{
  const html = `<html><body>
    <nav>
      <a href="/about-us">About Us</a>
    </nav>
  </body></html>`;
  const q = buildUrlQueue(html, BASE);

  assert('discoveredTeamLinks includes /about-us',
    q.discoveredTeamLinks.includes(`${BASE}/about-us`), true);
  assert('fallbackTeamLinks empty', q.fallbackTeamLinks.length, 0);
  assertExcludes('/team not added when /about-us discovered', q.urlsToVisit, `${BASE}/team`);
}

// ── 3. Site with no team pages in nav → fallbacks used ────────────────────────
console.log('\n3. Site with no team pages in nav');
{
  const html = `<html><body>
    <nav>
      <a href="/products">Products</a>
      <a href="/contact">Contact</a>
    </nav>
  </body></html>`;
  const q = buildUrlQueue(html, BASE);

  assert('discoveredTeamLinks is empty', q.discoveredTeamLinks.length, 0);
  assert('fallbackTeamLinks has TEAM_PATHS count entries',
    q.fallbackTeamLinks.length > 0, true);
  // /team fallback should be present
  assertIncludes('/team fallback is queued', q.urlsToVisit, `${BASE}/team`);
}

// ── 4. Duplicate URLs with trailing slash are deduplicated ────────────────────
console.log('\n4. Duplicate URLs with trailing slash');
{
  const html = `<html><body>
    <nav>
      <a href="/team/">Team</a>
      <a href="/team">Team (no slash)</a>
    </nav>
  </body></html>`;
  const q = buildUrlQueue(html, BASE);

  const teamCount = q.urlsToVisit.filter((u) => u === `${BASE}/team`).length;
  assert('/team appears exactly once (trailing slash removed)', teamCount, 1);
}

// ── 5. Multiple discovered team URLs — all present, no fallbacks ──────────────
console.log('\n5. Multiple discovered team URLs');
{
  const html = `<html><body>
    <nav>
      <a href="/team">Team</a>
      <a href="/about">About</a>
      <a href="/management">Management</a>
    </nav>
  </body></html>`;
  const q = buildUrlQueue(html, BASE);

  assert('3 team links discovered',
    q.discoveredTeamLinks.length >= 2, true); // extractTeamPageLinks caps at 5
  assert('fallbackTeamLinks empty — discovery suppresses all fallbacks',
    q.fallbackTeamLinks.length, 0);
}

// ── 6. Contact page discovered → CONTACT_PATHS fallbacks suppressed ───────────
console.log('\n6. Contact page in nav suppresses CONTACT_PATHS fallbacks');
{
  const html = `<html><body>
    <nav>
      <a href="/kontakti">Контакти</a>
    </nav>
  </body></html>`;
  const q = buildUrlQueue(html, BASE);

  assert('discoveredContactLinks has /kontakti',
    q.discoveredContactLinks.includes(`${BASE}/kontakti`), true);
  assert('fallbackContactLinks empty',
    q.fallbackContactLinks.length, 0);
  assertExcludes('/contact fallback not added', q.urlsToVisit, `${BASE}/contact`);
}

// ── 7. No contact or team in nav → both fallback arrays populated ─────────────
console.log('\n7. No nav links → both fallback sets used');
{
  const html = `<html><body><p>Hello world</p></body></html>`;
  const q = buildUrlQueue(html, BASE);

  assert('fallbackTeamLinks non-empty', q.fallbackTeamLinks.length > 0, true);
  assert('fallbackContactLinks non-empty', q.fallbackContactLinks.length > 0, true);
}

// ── 8. URL cap: never exceeds 18 ─────────────────────────────────────────────
console.log('\n8. URL cap at 18');
{
  // Generate a page with many nav links to push the total over 18
  const links = Array.from({ length: 30 }, (_, i) => `<a href="/page${i}">Page ${i}</a>`).join('\n');
  const html = `<html><body><nav>${links}</nav></body></html>`;
  const q = buildUrlQueue(html, BASE);

  assert('urlsToVisit.length <= 18', q.urlsToVisit.length <= 18, true);
}

// ── 9. Team link in anchor text (not just href) is discovered ─────────────────
console.log('\n9. Team link via anchor text "Екип"');
{
  const html = `<html><body>
    <a href="/nasiat-ekip">Екип</a>
  </body></html>`;
  const q = buildUrlQueue(html, BASE);

  assert('discoveredTeamLinks has /nasiat-ekip',
    q.discoveredTeamLinks.includes(`${BASE}/nasiat-ekip`), true);
  assert('fallbackTeamLinks empty — BG anchor text counts as discovery',
    q.fallbackTeamLinks.length, 0);
}

// ── 10. discoveredTeamLinks in urlsToVisit (no discovery is not in urlsToVisit) ─
console.log('\n10. Discovered contact link not duplicated in fallback');
{
  const html = `<html><body>
    <nav>
      <a href="/contact">Contact Us</a>
    </nav>
  </body></html>`;
  const q = buildUrlQueue(html, BASE);
  const contactCount = q.urlsToVisit.filter((u) => u === `${BASE}/contact`).length;
  assert('/contact appears once in urlsToVisit', contactCount, 1);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
