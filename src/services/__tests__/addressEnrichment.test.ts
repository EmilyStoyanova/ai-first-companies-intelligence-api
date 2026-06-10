/**
 * Tests for search-based address enrichment.
 *
 * Root cause of the missing-location problem:
 *   extractLocation() depends entirely on HTML/text from the crawled site.
 *   When the site has no <address> element, no class="address", and no
 *   street-indicator in the visible text (e.g. JS-rendered contact page,
 *   login-gated site, or a stone-product catalogue like yotovstone.com),
 *   the location field is null even though the address is publicly listed in
 *   directories and the site's own search-indexed contact page.
 *
 *   enrichAddress() runs two search queries after extractProfile() and fills
 *   or corrects the location using scored candidates from result snippets.
 *
 * Run with:  npx ts-node src/services/__tests__/addressEnrichment.test.ts
 */

import {
  scoreAddress,
  addressSimilarity,
  parseAddressCandidates,
  enrichAddress,
} from '../addressEnrichment';
import type { SearchResult } from '../../lib/search';

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

function assertGte(label: string, actual: number, min: number) {
  if (actual >= min) {
    console.log(`  ✓  ${label}  (${actual} >= ${min})`);
    passed++;
  } else {
    console.error(`  ✗  ${label}  (${actual} < ${min})`);
    failed++;
  }
}

function assertLt(label: string, actual: number, max: number) {
  if (actual < max) {
    console.log(`  ✓  ${label}  (${actual} < ${max})`);
    passed++;
  } else {
    console.error(`  ✗  ${label}  (${actual} >= ${max})`);
    failed++;
  }
}

function mockSearch(results: SearchResult[]) {
  return async (_q: string): Promise<SearchResult[]> => results;
}

// ── scoreAddress unit tests ───────────────────────────────────────────────────

console.log('\nscoreAddress — high confidence (street indicator present)');

assertGte(
  'Bulgarian бул. + postal code → high score',
  scoreAddress('бул. Стефан Стамболов 5, 3000 Враца'),
  60,
);
assertGte(
  'Cyrillic ул. + city → score ≥ 40',
  scoreAddress('ул. Иван Вазов 12, София'),
  40,
);
assertGte(
  'Latin str. street → score ≥ 40',
  scoreAddress('str. Mihai Eminescu 14, Bucharest'),
  40,
);
assertGte(
  'Western "street" keyword → score ≥ 40',
  scoreAddress('47 Main Street, London'),
  40,
);
assertGte(
  'address label in text → score ≥ 40',
  scoreAddress('Address: Sofia, bul. Vitosha 12'),
  40,
);

console.log('\nscoreAddress — low confidence (no street indicator)');

assertLt('city-only "Sofia" → below threshold',    scoreAddress('Sofia'),           40);
assertLt('"Sofia, Bulgaria" (no street) → below',  scoreAddress('Sofia, Bulgaria'), 40);
assertLt('year "2005" alone → 0',                  scoreAddress('2005'),            40);

console.log('\nscoreAddress — rejected outright (timeline / CSS)');

assert(
  'timeline "2008Construction…" → score 0',
  scoreAddress('2008Construction of our first 1,500 sq.m. Production Facility'),
  0,
);
assert(
  'multi-year timeline → score 0',
  scoreAddress('2008 First plant | 2014 Second plant | 2020 Export'),
  0,
);
assert(
  'CSS text → score 0',
  scoreAddress('background: rgba(0,0,0,0.5); border: 1px solid #fff'),
  0,
);

console.log('\nscoreAddress — context signals boost score');

{
  const withCtx = scoreAddress(
    'ул. Ген. Колев 54, Варна',
    'Yotov Stone — Адрес: ул. Ген. Колев 54, Варна. Тел: 052/...',
    'Yotov Stone',
    'yotovstone.com',
  );
  const noCtx = scoreAddress('ул. Ген. Колев 54, Варна');
  assert('context (company name + адрес label) boosts score', withCtx > noCtx, true);
}

// ── addressSimilarity unit tests ──────────────────────────────────────────────

console.log('\naddressSimilarity — matching addresses');

assertGte(
  'same street, different format → ≥ 0.5',
  addressSimilarity('бул. Стефан Стамболов 5, 3000 Враца', 'бул. Стефан Стамболов 5, Враца, България'),
  0.5,
);
assertGte(
  'same address, minor variation → ≥ 0.5',
  addressSimilarity('ул. Иван Вазов 12, 1000 София', 'ул. Иван Вазов 12, Sofia'),
  0.5,
);

console.log('\naddressSimilarity — different addresses');

assertLt(
  'different city + street → < 0.5',
  addressSimilarity('бул. Стефан Стамболов 5, Враца', 'ул. Иван Вазов 12, Варна'),
  0.5,
);
assertLt(
  'city-only vs full address → < 0.3',
  addressSimilarity('Sofia', 'бул. Стефан Стамболов 5, Враца'),
  0.3,
);

// ── parseAddressCandidates unit tests ─────────────────────────────────────────

console.log('\nparseAddressCandidates — extracts valid candidates from snippets');

{
  const results: SearchResult[] = [
    {
      url: 'https://yotovstone.com/kontakti',
      title: 'Yotov Stone — Контакти',
      snippet: 'Адрес: бул. Стефан Стамболов 5, 3000 Враца\nТел: +359 92 123 456\nEmail: info@yotovstone.com',
    },
  ];
  const candidates = parseAddressCandidates(results, 'yotovstone.com', 'Yotov Stone');
  assert('at least one candidate found', candidates.length > 0, true);
  assert('best candidate contains street name', candidates[0]?.text.includes('Стамболов') ?? false, true);
  assertGte('best candidate score ≥ 60', candidates[0]?.score ?? 0, 60);
}

{
  const results: SearchResult[] = [
    {
      url: 'https://directory.bg/yotovstone',
      title: 'Yotov Stone — Directory.bg',
      snippet: '2008Construction of our first facility | 2014 Second warehouse expansion',
    },
  ];
  const candidates = parseAddressCandidates(results, 'yotovstone.com', 'Yotov Stone');
  assert('timeline in snippet → no candidates', candidates.length, 0);
}

{
  const results: SearchResult[] = [
    {
      url: 'https://somewhere.com/company',
      title: 'Some Company | Sofia',
      snippet: 'Sofia, Bulgaria',
    },
  ];
  const candidates = parseAddressCandidates(results, 'somecompany.bg', 'Some Company');
  assert('city-only snippet → no candidates (below threshold)', candidates.length, 0);
}

// ── enrichAddress integration tests (async) ───────────────────────────────────

async function runIntegrationTests(): Promise<void> {

  console.log('\nenrichAddress — Test 1: website address valid + search same → keep website');

  {
    const result = await enrichAddress(
      { location: 'бул. Стефан Стамболов 5, 3000 Враца', name: 'Yotov Stone' },
      'yotovstone.com',
      mockSearch([
        {
          url: 'https://yotovstone.com/kontakti',
          title: 'Yotov Stone — Контакти',
          snippet: 'Адрес: бул. Стефан Стамболов 5, Враца, България',
        },
      ]),
    );
    assert('source is website', result.source, 'website');
    assert('location unchanged', result.location, 'бул. Стефан Стамболов 5, 3000 Враца');
  }

  console.log('\nenrichAddress — Test 2: website address missing + search valid → use search');

  {
    const result = await enrichAddress(
      { location: undefined, name: 'Yotov Stone' },
      'yotovstone.com',
      mockSearch([
        {
          url: 'https://yotovstone.com/contacts',
          title: 'Yotov Stone Contacts | yotovstone.com',
          snippet: 'Адрес: бул. Стефан Стамболов 5, 3000 Враца\nТел: +359 92 123 456',
        },
      ]),
    );
    assert('source is search', result.source, 'search');
    assert('location is set', typeof result.location, 'string');
    assert('location contains street', result.location?.includes('Стамболов') ?? false, true);
    assertGte('confidence ≥ 40', result.confidence, 40);
  }

  console.log('\nenrichAddress — Test 3: website location is timeline → replace with search');

  {
    const result = await enrichAddress(
      {
        location: '2008Construction of our first 1,500 sq.m. Production Facility | 2010Construction of our 660 sq.m. Slab Warehouse',
        name: 'Yotov Stone',
      },
      'yotovstone.com',
      mockSearch([
        {
          url: 'https://yotovstone.com/contacts',
          title: 'Yotov Stone — Contacts',
          snippet: 'Address: бул. Стефан Стамболов 5, 3000 Враца, Bulgaria',
        },
      ]),
    );
    assert('source is search (timeline website location replaced)', result.source, 'search');
    assert('location does not contain 2008', result.location?.includes('2008') ?? false, false);
    assert('location contains street', result.location?.includes('Стамболов') ?? false, true);
  }

  console.log('\nenrichAddress — Test 4: website location has Distance: → Distance: stripped or replaced');

  {
    const result = await enrichAddress(
      {
        location: 'бул. Андрей Ляпчев 261А, София Distance: | площад Жеравица Distance:',
        name: 'Cross',
      },
      'cross.bg',
      mockSearch([]), // no search results
    );
    assert('source is website or none', ['website', 'none'].includes(result.source), true);
    if (result.location) {
      assert('Distance: stripped', result.location.includes('Distance:'), false);
    }
  }

  console.log('\nenrichAddress — Test 5: search result only city name → low confidence, not used');

  {
    const result = await enrichAddress(
      { location: undefined, name: 'Some Company' },
      'somecompany.bg',
      mockSearch([
        {
          url: 'https://somecompany.bg',
          title: 'Some Company | Sofia',
          snippet: 'Sofia, Bulgaria. Leading provider of services.',
        },
      ]),
    );
    assert('source is none (city-only candidate rejected)', result.source, 'none');
    assert('no location set', result.location, undefined);
  }

  console.log('\nenrichAddress — Test 6: conflicting addresses → higher confidence wins, note logged');

  {
    // "Враца, България" scores < 40 (no street indicator); search scores ≥ 60 → search wins
    const result = await enrichAddress(
      { location: 'Враца, България', name: 'Yotov Stone' },
      'yotovstone.com',
      mockSearch([
        {
          url: 'https://yotovstone.com/contacts',
          title: 'Yotov Stone — Contacts | yotovstone.com',
          snippet: 'Адрес: бул. Стефан Стамболов 5, 3000 Враца\nPhone: +359 92...',
        },
      ]),
    );
    assert('source is search (much higher confidence)', result.source, 'search');
    assert('location is the richer search address', result.location?.includes('Стамболов') ?? false, true);
    assert('conflict note is set', typeof result.note, 'string');
  }

  console.log('\nenrichAddress — no search results + no website location → none');

  {
    const result = await enrichAddress(
      { location: undefined, name: 'Mystery Corp' },
      'mystery.bg',
      mockSearch([]),
    );
    assert('source is none', result.source, 'none');
    assert('confidence is 0', result.confidence, 0);
    assert('location is undefined', result.location, undefined);
  }
}

// ── Run everything ────────────────────────────────────────────────────────────

runIntegrationTests().then(() => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
