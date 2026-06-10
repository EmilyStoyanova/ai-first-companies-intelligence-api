/**
 * Tests for service extraction quality filtering (isJunkService + extractProfile).
 *
 * Root cause of the garbage-services bug:
 *   Both extractServicesFromHtml and extractServicesFromText only checked
 *   string length (> 2 && < 120).  A failed CMS template that renders "Error:"
 *   into a .service-title element, or a developer leaving "test 1" / "test 2"
 *   in a services list, passed the length check with no further validation.
 *
 * Fix: JUNK_SERVICE_RE rejects test/debug/placeholder/error/null strings.
 *   Applied at every items.add and items.push call site in both paths.
 *
 * Run with:  npx ts-node src/services/__tests__/extractServices.test.ts
 */

import { isJunkService, isSectionHeadingNoise, extractProfile } from '../extraction';

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

// ── isJunkService unit tests ──────────────────────────────────────────────────
console.log('\nisJunkService — must return TRUE (junk)');

// Error / warning / loading states
assert('Error:',        isJunkService('Error:'),        true);
assert('error:',        isJunkService('error:'),        true);
assert('ERROR:',        isJunkService('ERROR:'),        true);
assert('Error',         isJunkService('Error'),         true);
assert('Warning:',      isJunkService('Warning:'),      true);
assert('warning',       isJunkService('warning'),       true);
assert('Loading...',    isJunkService('Loading...'),    true);
assert('Loading',       isJunkService('Loading'),       true);
assert('loading...',    isJunkService('loading...'),    true);

// Test / debug entries
assert('test',          isJunkService('test'),          true);
assert('Test',          isJunkService('Test'),          true);
assert('TEST',          isJunkService('TEST'),          true);
assert('test 1',        isJunkService('test 1'),        true);
assert('test 2',        isJunkService('test 2'),        true);
assert('test 3',        isJunkService('test 3'),        true);
assert('test123',       isJunkService('test123'),       true);
assert('demo',          isJunkService('demo'),          true);
assert('Demo',          isJunkService('Demo'),          true);
assert('debug',         isJunkService('debug'),         true);

// Placeholder / example content
assert('placeholder',   isJunkService('placeholder'),   true);
assert('Placeholder',   isJunkService('Placeholder'),   true);
assert('sample',        isJunkService('sample'),        true);
assert('example',       isJunkService('example'),       true);
assert('lorem',         isJunkService('lorem'),         true);
assert('lorem ipsum',   isJunkService('lorem ipsum'),   true);

// JS null/undefined literals
assert('undefined',     isJunkService('undefined'),     true);
assert('null',          isJunkService('null'),          true);
assert('nan',           isJunkService('nan'),           true);
assert('NaN',           isJunkService('NaN'),           true);
assert('n/a',           isJunkService('n/a'),           true);
assert('N/A',           isJunkService('N/A'),           true);

// Leading/trailing whitespace must not defeat the filter
assert('"  test  " (whitespace)',     isJunkService('  test  '),      true);
assert('"  Error:  " (whitespace)',   isJunkService('  Error:  '),    true);

// ── isJunkService — must return FALSE (real service names) ────────────────────
console.log('\nisJunkService — must return FALSE (real services)');

assert('PVC дограма',          isJunkService('PVC дограма'),          false);
assert('Алуминиева дограма',   isJunkService('Алуминиева дограма'),   false);
assert('Transport Services',   isJunkService('Transport Services'),   false);
assert('Logistics Solutions',  isJunkService('Logistics Solutions'),  false);
assert('Error handling',       isJunkService('Error handling'),       false); // "Error" not alone
assert('Demo services',        isJunkService('Demo services'),        false); // "Demo" not alone
assert('Testing strategy',     isJunkService('Testing strategy'),     false); // "Test" not alone
assert('Undefined requirements', isJunkService('Undefined requirements'), false);
assert('Loading dock services', isJunkService('Loading dock services'), false);

// ── Integration: HTML path rejects junk items ─────────────────────────────────
// Strategy 1 (heading + list)
console.log('\nHTML path — Strategy 1 (heading + list)');

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>Our Services</h2>' +
      '<ul>' +
        '<li>Error:</li>' +
        '<li>test 1</li>' +
        '<li>test 2</li>' +
        '<li>test 3</li>' +
        '<li>PVC дограма</li>' +
        '<li>Алуминиева дограма</li>' +
      '</ul>' +
    '</body></html>',
  )]);
  assert(
    'Junk items removed from service list, real items kept',
    [...profile.services].sort(),
    ['Алуминиева дограма', 'PVC дограма'].sort(),
  );
}

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>What we offer</h2>' +
      '<ul>' +
        '<li>undefined</li>' +
        '<li>null</li>' +
        '<li>Loading...</li>' +
        '<li>Transport Services</li>' +
        '<li>Logistics Solutions</li>' +
      '</ul>' +
    '</body></html>',
  )]);
  assert(
    'null / undefined / Loading removed, real services kept',
    [...profile.services].sort(),
    ['Logistics Solutions', 'Transport Services'].sort(),
  );
}

// Strategy 2 (service class elements)
console.log('\nHTML path — Strategy 2 (service class elements)');

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<div class="services-grid">' +
        '<div class="service-item"><h3>Error:</h3></div>' +
        '<div class="service-item"><h3>demo</h3></div>' +
        '<div class="service-item"><h3>PVC дограма</h3></div>' +
      '</div>' +
    '</body></html>',
  )]);
  assert(
    'Error: and demo removed from service class elements, PVC kept',
    profile.services,
    ['PVC дограма'],
  );
}

// Strategy 3 (title class elements)
// Note: SERVICE_CONTEXT_RE already rejects items containing "service"/"solution"
// to prevent section headings from being included; test fixtures avoid those words.
console.log('\nHTML path — Strategy 3 (title class elements)');

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<div class="card-grid">' +
        '<h4 class="card-title">test</h4>' +
        '<h4 class="card-title">placeholder</h4>' +
        '<h4 class="card-title">PVC дограма</h4>' +
        '<h4 class="card-title">Алуминиева дограма</h4>' +
      '</div>' +
    '</body></html>',
  )]);
  assert(
    'test and placeholder removed from card-title elements, real items kept',
    [...profile.services].sort(),
    ['Алуминиева дограма', 'PVC дограма'].sort(),
  );
}

// ── Integration: Text path rejects junk items ─────────────────────────────────
console.log('\nText path — junk filtering');

{
  const text = [
    'Services',
    'Error:',
    'test 1',
    'test 2',
    'test 3',
    'PVC дограма',
    'Алуминиева дограма',
  ].join('\n');
  const profile = extractProfile([makePage('<html><head><title>Company</title></head><body></body></html>', text)]);
  assert(
    'Text path: junk items removed, real services kept',
    [...profile.services].sort(),
    ['Алуминиева дограма', 'PVC дограма'].sort(),
  );
}

{
  const text = [
    'Services',
    'undefined',
    'null',
    'Loading...',
    'demo',
    'Transport Services',
    'Logistics Solutions',
  ].join('\n');
  const profile = extractProfile([makePage('<html><head><title>Company</title></head><body></body></html>', text)]);
  assert(
    'Text path: null / undefined / Loading / demo removed',
    [...profile.services].sort(),
    ['Logistics Solutions', 'Transport Services'].sort(),
  );
}

// ── All-junk list → empty services, not a list of garbage ────────────────────
console.log('\nAll-junk list → empty services array');

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>Our Services</h2>' +
      '<ul>' +
        '<li>Error:</li>' +
        '<li>test 1</li>' +
        '<li>test 2</li>' +
        '<li>Loading...</li>' +
        '<li>undefined</li>' +
      '</ul>' +
    '</body></html>',
  )]);
  assert('All-junk list → services is empty array', profile.services, []);
}

// ── isSectionHeadingNoise unit tests ─────────────────────────────────────────
// Root cause reference: "Защо ние ?", "Предимства:", "Additional technologies:",
// "Special Processes:", "Final Assembly:" were collected as services because
// extractServicesFromHtml had no guard for trailing punctuation or marketing titles.

console.log('\nisSectionHeadingNoise — must return TRUE (headings / marketing labels)');

// Exact failing examples reported by user
assert('"Защо ние ?" (trailing ?)',           isSectionHeadingNoise('Защо ние ?'),              true);
assert('"Предимства:" (trailing :)',           isSectionHeadingNoise('Предимства:'),             true);
assert('"Additional technologies:" (:)',       isSectionHeadingNoise('Additional technologies:'), true);
assert('"Special Processes:" (:)',             isSectionHeadingNoise('Special Processes:'),       true);
assert('"Final Assembly:" (:)',                isSectionHeadingNoise('Final Assembly:'),          true);

// Trailing punctuation patterns
assert('Trailing : (generic)',                 isSectionHeadingNoise('Category:'),               true);
assert('Trailing ? (generic)',                 isSectionHeadingNoise('What do we do?'),          true);
assert('Trailing :  with space',               isSectionHeadingNoise('Category:  '),             true);

// Marketing heading words (no trailing punctuation)
assert('"Защо ние" (no ?)',                    isSectionHeadingNoise('Защо ние'),                true);
assert('"Why us" (EN)',                        isSectionHeadingNoise('Why us'),                  true);
assert('"Why choose us" (EN)',                 isSectionHeadingNoise('Why choose us'),           true);
assert('"Предимства" (no :)',                  isSectionHeadingNoise('Предимства'),              true);
assert('"Advantages" (EN)',                    isSectionHeadingNoise('Advantages'),              true);
assert('"Benefits" (EN)',                      isSectionHeadingNoise('Benefits'),                true);
assert('"Strengths" (EN)',                     isSectionHeadingNoise('Strengths'),               true);
assert('"Highlights" (EN)',                    isSectionHeadingNoise('Highlights'),              true);
assert('"Our advantages" (EN)',                isSectionHeadingNoise('Our advantages'),          true);
assert('"Our benefits" (EN)',                  isSectionHeadingNoise('Our benefits'),            true);

console.log('\nisSectionHeadingNoise — must return FALSE (real service names)');

assert('"PVC дограма" (service)',              isSectionHeadingNoise('PVC дограма'),             false);
assert('"Логистика" (service)',                isSectionHeadingNoise('Логистика'),               false);
assert('"Транспортни услуги" (service)',       isSectionHeadingNoise('Транспортни услуги'),      false);
assert('"Metal fabrication" (service)',        isSectionHeadingNoise('Metal fabrication'),       false);
assert('"Injection molding" (service)',        isSectionHeadingNoise('Injection molding'),       false);
assert('"Software development" (service)',     isSectionHeadingNoise('Software development'),    false);
// Without the colon, these are valid manufacturing service names
assert('"Special Processes" (no colon)',       isSectionHeadingNoise('Special Processes'),       false);
assert('"Final Assembly" (no colon)',          isSectionHeadingNoise('Final Assembly'),          false);
assert('"Additional technologies" (no colon)', isSectionHeadingNoise('Additional technologies'), false);
// Short compound names must not be affected
assert('"Web design" (service)',               isSectionHeadingNoise('Web design'),              false);
assert('"SEO" (service)',                      isSectionHeadingNoise('SEO'),                     false);

// ── Integration: HTML path rejects section headings and marketing labels ────────
console.log('\nHTML path — section headings filtered from service lists');

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<h2>What we do</h2>' +
      '<ul>' +
        '<li>Additional technologies:</li>' +
        '<li>Special Processes:</li>' +
        '<li>Final Assembly:</li>' +
        '<li>Injection molding</li>' +
        '<li>Metal fabrication</li>' +
      '</ul>' +
    '</body></html>',
  )]);
  assert(
    'Section-label headings with ":" filtered; real services kept',
    [...profile.services].sort(),
    ['Injection molding', 'Metal fabrication'].sort(),
  );
}

{
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<div class="feature-block"><h3>Защо ние ?</h3></div>' +
      '<div class="feature-block"><h3>Предимства:</h3></div>' +
      '<div class="feature-block"><h3>PVC дограма</h3></div>' +
      '<div class="feature-block"><h3>Алуминиева дограма</h3></div>' +
    '</body></html>',
  )]);
  assert(
    'Marketing headings filtered from feature blocks; real services kept',
    [...profile.services].sort(),
    ['Алуминиева дограма', 'PVC дограма'].sort(),
  );
}

{
  // Real-world structure: h2 + sibling h3s inside a wrapping <section> (the
  // structure Strategy 1's closest('section') is designed for).
  const profile = extractProfile([makePage(
    '<html><body>' +
      '<section class="services">' +
        '<h2>Our Services</h2>' +
        '<h3>Additional technologies:</h3>' +
        '<h3>Special Processes:</h3>' +
        '<h3>Final Assembly:</h3>' +
        '<h3>Injection molding</h3>' +
        '<h3>Metal fabrication</h3>' +
      '</section>' +
    '</body></html>',
  )]);
  assert(
    'Sub-section label h3s inside services section filtered; real services kept',
    [...profile.services].sort(),
    ['Injection molding', 'Metal fabrication'].sort(),
  );
}

console.log('\nText path — section headings filtered');

{
  const text = [
    'Services',
    'Защо ние ?',
    'Предимства:',
    'Additional technologies:',
    'PVC дограма',
    'Алуминиева дограма',
  ].join('\n');
  const profile = extractProfile([makePage('<html><head><title>Company</title></head><body></body></html>', text)]);
  assert(
    'Text path: section headings removed, real services kept',
    [...profile.services].sort(),
    ['Алуминиева дограма', 'PVC дограма'].sort(),
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
