/**
 * Tests for extractDescription (via extractProfile with mock CrawledPage fixtures).
 *
 * Root cause of the artificial-ellipsis bug:
 *   extractDescription() previously sliced every source at 300 chars and appended
 *   '…' before saving to the database.  The fix removes MAX_DESC and returns the
 *   full string from all three sources (meta description, og:description, <p> fallback).
 *
 * Run with:  npx ts-node src/services/__tests__/extractDescription.test.ts
 */

import { extractProfile } from '../extraction';

let passed = 0;
let failed = 0;

function makePage(html: string, url = 'https://example-company.bg/'): Parameters<typeof extractProfile>[0][0] {
  return { url, html, text: '', emails: [], phones: [], loginProtected: false, logoUrls: [] };
}

function assertDesc(label: string, pages: Parameters<typeof extractProfile>[0], expected: string | undefined) {
  const got = extractProfile(pages).description;
  const ok = got === expected;
  if (ok) {
    const preview = got ? got.slice(0, 60) + (got.length > 60 ? '…' : '') : String(got);
    console.log(`  ✓  ${label}  →  ${JSON.stringify(preview)}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       got:      ${JSON.stringify(got?.slice(0, 120))}`);
    console.error(`       expected: ${JSON.stringify(expected?.slice(0, 120))}`);
    failed++;
  }
}

// Long description used across multiple tests (> 300 chars, previously truncated).
const LONG_DESC =
  'Фирмата предоставя пълен спектър от услуги в областта на строителството, ' +
  'ремонта и реновирането на сгради. През годините сме обслужили много български ' +
  'и чуждестранни клиенти и продължаваме да разширяваме нашата дейност на ' +
  'национално и международно ниво с висококачествени материали и доказани технологии.';
// Sanity: must be > 300 so the old bug would have triggered
if (LONG_DESC.length <= 300) throw new Error('LONG_DESC fixture is too short — increase it');

// ── Full description stored without artificial ellipsis ───────────────────────
console.log('\nFull description must be stored as-is (no artificial truncation)');

assertDesc(
  'meta description > 300 chars stored in full',
  [makePage(
    `<html><head><meta name="description" content="${LONG_DESC}"></head><body></body></html>`,
  )],
  LONG_DESC,
);

assertDesc(
  'og:description > 300 chars stored in full',
  [makePage(
    `<html><head><meta property="og:description" content="${LONG_DESC}"></head><body></body></html>`,
  )],
  LONG_DESC,
);

assertDesc(
  'fallback <p> > 300 chars stored in full',
  [makePage(
    `<html><head><title>Company</title></head><body><p>${LONG_DESC}</p></body></html>`,
  )],
  LONG_DESC,
);

// Confirm no trailing artificial '…' on a description that ends at exactly 300 chars
const EXACTLY_300 = 'А'.repeat(300);
assertDesc(
  'description of exactly 300 chars has no appended ellipsis',
  [makePage(
    `<html><head><meta name="description" content="${EXACTLY_300}"></head><body></body></html>`,
  )],
  EXACTLY_300,
);

// ── Source priority: meta > og > <p> ─────────────────────────────────────────
console.log('\nSource priority');

assertDesc(
  'meta description wins over og:description',
  [makePage(
    '<html><head>' +
      '<meta name="description" content="Description from the meta name tag, long enough.">' +
      '<meta property="og:description" content="Description from the og:description tag, long enough.">' +
      '</head><body></body></html>',
  )],
  'Description from the meta name tag, long enough.',
);

assertDesc(
  'og:description wins over <p> fallback when meta absent',
  [makePage(
    '<html><head>' +
      '<meta property="og:description" content="Description from the og:description tag, long enough.">' +
      '</head><body><p>From paragraph text that is long enough to qualify as fallback.</p></body></html>',
  )],
  'Description from the og:description tag, long enough.',
);

assertDesc(
  '<p> fallback used when meta and og absent',
  [makePage(
    '<html><head><title>Company</title></head>' +
      '<body><p>From paragraph text that is long enough to qualify as fallback.</p></body></html>',
  )],
  'From paragraph text that is long enough to qualify as fallback.',
);

// ── Original ellipsis from source text must be preserved ─────────────────────
console.log('\nOriginal ellipsis from source text preserved');

const WITH_NATURAL_ELLIPSIS =
  'Специализираме се в доставка на оборудване за хотели, ресторанти и кетъринг… ' +
  'вижте нашия каталог за повече информация.';
assertDesc(
  'natural … in meta description is not stripped',
  [makePage(
    `<html><head><meta name="description" content="${WITH_NATURAL_ELLIPSIS}"></head><body></body></html>`,
  )],
  WITH_NATURAL_ELLIPSIS,
);

const WITH_ASCII_ELLIPSIS =
  'Предлагаме широк асортимент от продукти... Свържете се с нас за оферта.';
assertDesc(
  'natural ... (ASCII) in meta description is not stripped',
  [makePage(
    `<html><head><meta name="description" content="${WITH_ASCII_ELLIPSIS}"></head><body></body></html>`,
  )],
  WITH_ASCII_ELLIPSIS,
);

// ── Short / empty content is ignored ─────────────────────────────────────────
console.log('\nShort / empty content rejected');

assertDesc(
  'meta description ≤ 20 chars is skipped (falls through to next source)',
  [makePage(
    '<html><head>' +
      '<meta name="description" content="Short.">' +
      '<meta property="og:description" content="From OG tag that is long enough.">' +
      '</head><body></body></html>',
  )],
  'From OG tag that is long enough.',
);

assertDesc(
  'empty description tags → undefined',
  [makePage('<html><head></head><body></body></html>')],
  undefined,
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
