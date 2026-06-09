/**
 * Tests for extractPhones — Bulgarian and international phone formats.
 * Run with:  npx ts-node src/lib/__tests__/extractPhones.test.ts
 */

import { extractPhones, normalizePhone, canonicalizePhone } from '../phoneExtraction';

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

function assertCount(label: string, text: string, expectedCount: number) {
  const phones = extractPhones(text);
  const ok = phones.length === expectedCount;
  if (ok) {
    console.log(`  ✓  ${label}  →  ${JSON.stringify(phones)}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       got ${phones.length} phones: ${JSON.stringify(phones)}`);
    console.error(`       expected ${expectedCount}`);
    failed++;
  }
}

function assertContains(label: string, text: string, substr: string) {
  const phones = extractPhones(text);
  const ok = phones.some((p) => p.includes(substr) || p.replace(/[\s\-./()]/g, '').includes(substr.replace(/[\s\-./()]/g, '')));
  if (ok) {
    console.log(`  ✓  ${label}  →  ${JSON.stringify(phones)}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       phones: ${JSON.stringify(phones)}, expected to contain "${substr}"`);
    failed++;
  }
}

// ── Cases 1–6: recognised formats ─────────────────────────────────────────────
console.log('\nRecognised phone formats');

assertCount('1. "0893 / 35 41 42" → 1 phone',
  '0893 / 35 41 42', 1);

assertCount('2. "0893 / 35 41 42Пон - Пет: 8:00 - 17:30" → 1 phone (not hours)',
  '0893 / 35 41 42Пон - Пет: 8:00 - 17:30', 1);

assertCount('3. "0877/86-62-18" → 1 phone',
  '0877/86-62-18', 1);

assertContains('4. "+359 2 979 1688" → 1 phone',
  '+359 2 979 1688', '979');

assertContains('5. "+359 879 603 642" → 1 phone',
  '+359 879 603 642', '603');

assertContains('6. "02 979 1688" → 1 phone',
  '02 979 1688', '979');

// ── Case 7: deduplication ──────────────────────────────────────────────────────
console.log('\nDeduplication');

assert('7a. "0893 / 35 41 42" and "0893/35 41 42" → 1 entry',
  extractPhones('0893 / 35 41 42\n0893/35 41 42').length, 1);

assert('7b. "+359 2 979 1688" and "+35929791688" → 1 entry',
  extractPhones('+359 2 979 1688\n+35929791688').length, 1);

assert('7c. "0877 86 62 18" and "0877-86-62-18" → 1 entry',
  extractPhones('0877 86 62 18\n0877-86-62-18').length, 1);

// ── Cases 8–10: must NOT extract ──────────────────────────────────────────────
console.log('\nFalse-positive guards');

assertCount('8. "EIK: 201251616" → 0 phones',
  'EIK: 201251616', 0);

assertCount('9. "2022 - Serpio.bg" → 0 phones',
  '2022 - Serpio.bg', 0);

assertCount('10. "8:00 - 17:30" → 0 phones',
  '8:00 - 17:30', 0);

// ── Additional edge cases ──────────────────────────────────────────────────────
console.log('\nAdditional edge cases');

assertCount('+359 910 927 87',
  '+359 910 927 87', 1);

assertCount('02/979 1688',
  '02/979 1688', 1);

assertCount('date "12.05.2024" → 0 phones',
  '12.05.2024', 0);

assertCount('IPv4 "192.168.1.1" → 0 phones',
  '192.168.1.1', 0);

assertCount('"0893354142" (no separators) → 1 phone',
  '0893354142', 1);

// Two different phones in same text → both kept
assert('Two different phones → 2 entries',
  extractPhones('0877/86-62-18 и +359 2 979 1688').length, 2);

// Same phone via two separators on same page → 1 entry
assert('Same phone twice in same text → 1 entry',
  extractPhones('0877 86 62 18 ... 0877-86-62-18').length, 1);

// ── Multiline / table-whitespace rejection ────────────────────────────────────
console.log('\nMultiline rejection (table whitespace bleed)');

// The phone itself is valid; only the "14" from the next line must NOT be appended.
// Previously the regex matched "087530000014" (12 digits); now it stops at \n.
assert(
  '"0875 300 000\\n...\\n14" → phone extracted WITHOUT the dangling 14',
  extractPhones('0875 300 000\n                    \n                \n                14'),
  ['0875 300 000'],
);

assertCount(
  '"070141\\n...\\n69.00" → 0 (price on next line)',
  '070141\n                    \n                        69.00',
  0,
);

assertCount(
  '"01.2026\\n...\\n3" → 0 (date/code across lines)',
  '01.2026\n                        3',
  0,
);

// ── Item-code / version-number rejection (00X-D.DDD-NNNN pattern) ─────────────
console.log('\nItem-code rejection (00X-D.DDD-NNNN)');

assertCount(
  '"002-2.077-1237-" → 0 (European decimal thousands separator = item code)',
  '002-2.077-1237-',
  0,
);

assertCount(
  '"001-1.003-0569-" → 0 (same pattern)',
  '001-1.003-0569-',
  0,
);

assertCount(
  '"002-1.004-0737-" → 0',
  '002-1.004-0737-',
  0,
);

// Real 00-prefix international phone must NOT be rejected
assertCount(
  '"0044 20 7946 0958" → 1 (valid UK international via 00)',
  '0044 20 7946 0958',
  1,
);

// ── Trailing-separator deduplication (bug-report patterns) ───────────────────
// Root cause of the production duplicate:
//   "0893 / 35 41 42" comes from page A; "+359 2 979 1688" from page B.
//   extractPhones trims trailing separators at the display step so both pages
//   store the clean form; normalizePhone then deduplicates by digit-only key.
//   The stale DB data (with " -") predates the current extraction code.
console.log('\nTrailing-separator dedup (bug-report patterns from parshevitsa.com)');

// Trimming: extractPhones must strip " -" before storing the display form
assert(
  '"+359 2 979 1688 -" → stored as "+359 2 979 1688" (trailing sep trimmed)',
  extractPhones('+359 2 979 1688 -'),
  ['+359 2 979 1688'],
);

assert(
  '"+359 2 979 17 75 -" → stored as "+359 2 979 17 75"',
  extractPhones('+359 2 979 17 75 -'),
  ['+359 2 979 17 75'],
);

assert(
  '"+359 87 9603642 -" → stored as "+359 87 9603642"',
  extractPhones('+359 87 9603642 -'),
  ['+359 87 9603642'],
);

// Same-page dedup: trailing-hyphen and clean form on the same page → 1 entry
assert(
  '"+359 2 979 1688 -" and "+359 2 979 1688" on same page → 1 entry',
  extractPhones('+359 2 979 1688 -\n+359 2 979 1688').length,
  1,
);
assert(
  '"+359 2 979 17 75 -" and "+359 2 979 17 75" → 1 entry',
  extractPhones('+359 2 979 17 75 -\n+359 2 979 17 75').length,
  1,
);
assert(
  '"+359 87 9603642 -" and "+359 87 9603642" → 1 entry',
  extractPhones('+359 87 9603642 -\n+359 87 9603642').length,
  1,
);

// Cross-page dedup (simulates extractProfile phoneMap using canonicalizePhone):
// Mirrors the logic in extraction.ts — canonical key, international form wins.
{
  const mergePhones = (lists: string[][]): string[] => {
    const phoneMap = new Map<string, string>();
    for (const phone of lists.flat()) {
      const norm = normalizePhone(phone);
      const canonical = canonicalizePhone(norm);
      if (!phoneMap.has(canonical)) {
        phoneMap.set(canonical, phone);
      } else if (norm.startsWith('+') && !normalizePhone(phoneMap.get(canonical)!).startsWith('+')) {
        phoneMap.set(canonical, phone);
      }
    }
    return [...phoneMap.values()];
  };

  assert(
    'Cross-page: trailing-hyphen page + clean page → 1 merged entry',
    mergePhones([
      extractPhones('+359 2 979 1688 -'),  // page A → "+359 2 979 1688"
      extractPhones('+359 2 979 1688'),     // page B → "+359 2 979 1688"
    ]),
    ['+359 2 979 1688'],
  );

  assert(
    'Cross-page: local form page + international form page → 1 entry, international wins',
    mergePhones([
      extractPhones('0875 300 000'),         // page A → local form
      extractPhones('+359 875 300 000'),      // page B → international form
    ]),
    ['+359 875 300 000'],
  );

  assert(
    'Cross-page: international form page + local form page → 1 entry, international wins',
    mergePhones([
      extractPhones('+359 875 300 000'),      // page A → international form
      extractPhones('0875 300 000'),          // page B → local form
    ]),
    ['+359 875 300 000'],
  );
}

// Display-form quality: the stored display must NOT contain trailing separators
assert(
  'Trailing " -" is absent from the stored display',
  extractPhones('+359 2 979 1688 -').every((p) => !/[\s\-./()]+$/.test(p)),
  true,
);

// ── Genuinely different numbers are not merged ────────────────────────────────
console.log('\nGenuinely different numbers kept separate');

assert(
  'Landline +359 2 979 1688 and mobile +359 87 9603642 → 2 entries',
  extractPhones('+359 2 979 1688\n+359 87 9603642').length,
  2,
);
assert(
  '0877/86-62-18 and 0893 / 35 41 42 → 2 entries',
  extractPhones('0877/86-62-18\n0893 / 35 41 42').length,
  2,
);

// ── Slash-separated Bulgarian mobile (already covered, explicit label) ────────
console.log('\nSlash-separated Bulgarian numbers');
assert(
  '"0893 / 35 41 42" → 1 phone, display preserved',
  extractPhones('0893 / 35 41 42'),
  ['0893 / 35 41 42'],
);
assert(
  '"0877/86-62-18" → 1 phone',
  extractPhones('0877/86-62-18'),
  ['0877/86-62-18'],
);

// ── Bulgarian landline formats ────────────────────────────────────────────────
console.log('\nBulgarian landline formats');
assert(
  '"02 979 1688" → 1 phone',
  extractPhones('02 979 1688'),
  ['02 979 1688'],
);
assert(
  '"02/979 1688" and "02 979 1688" → 1 entry (same landline)',
  extractPhones('02/979 1688\n02 979 1688').length,
  1,
);
assert(
  '"+359 2 979 1688" and "02 979 1688" → 1 entry (same number, international wins)',
  extractPhones('+359 2 979 1688\n02 979 1688'),
  ['+359 2 979 1688'],
);

// ── Bulgarian mobile formats ──────────────────────────────────────────────────
console.log('\nBulgarian mobile formats');
assert(
  '"0879 123 456" → 1 phone',
  extractPhones('0879 123 456'),
  ['0879 123 456'],
);
assert(
  '"0879-123-456" and "0879 123 456" → 1 entry',
  extractPhones('0879-123-456\n0879 123 456').length,
  1,
);
assert(
  '"+359 879 123 456" and "0879 123 456" → 1 entry (same number, international wins)',
  extractPhones('+359 879 123 456\n0879 123 456'),
  ['+359 879 123 456'],
);

// ── International / local form deduplication ─────────────────────────────────
// Root cause of the original bug: normalizePhone() strips formatting only, so
// "0875300000" ≠ "+359875300000" and both were stored.
// Fix: canonicalizePhone() converts local 0-prefix to +countryCode before using
// the result as the dedup key.  International form is always preferred as display.
console.log('\nInternational / local form deduplication');

// The exact bug case from the report
assert(
  '"0875 300 000" then "+359 875 300 000" → 1 entry, international form stored',
  extractPhones('0875 300 000\n+359 875 300 000'),
  ['+359 875 300 000'],
);

assert(
  '"+359 875 300 000" then "0875 300 000" → 1 entry regardless of order',
  extractPhones('+359 875 300 000\n0875 300 000'),
  ['+359 875 300 000'],
);

// 00-prefix international form also normalises to the same canonical
assert(
  '"00359875300000" and "0875 300 000" → 1 entry',
  extractPhones('00359875300000\n0875 300 000').length,
  1,
);

// All three representations of the same number in one text → 1 entry
assert(
  'local, 00-prefix, +-prefix all in one text → 1 entry',
  extractPhones('0875 300 000\n00359875300000\n+359 875 300 000').length,
  1,
);

// Two genuinely different numbers must NOT be merged
assert(
  '"0875 300 000" and "0898 870 562" → 2 entries (different numbers)',
  extractPhones('0875 300 000\n0898 870 562').length,
  2,
);

assert(
  '"+359 875 300 000" and "+359 898 870 562" → 2 entries',
  extractPhones('+359 875 300 000\n+359 898 870 562').length,
  2,
);

// canonicalizePhone unit tests
console.log('\ncanonicalizePhone unit tests');

function assertCanon(label: string, input: string, expected: string) {
  const got = canonicalizePhone(input);
  if (got === expected) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}  got ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
    failed++;
  }
}

assertCanon('local 0-prefix → +359 prefix',   '0875300000',     '+359875300000');
assertCanon('local with area code 02',         '029791688',      '+35929791688');
assertCanon('00359-prefix → +359-prefix',      '00359875300000', '+359875300000');
assertCanon('+359-prefix unchanged',           '+359875300000',  '+359875300000');
assertCanon('+44 non-BG unchanged',            '+44207946xxxx',  '+44207946xxxx');
assertCanon('00-prefix non-BG unchanged',      '0044207946xxxx', '0044207946xxxx');

// ── Embedded-date / document-reference rejection ─────────────────────────────
// Root cause: PHONE_RE is permissive by design. "01/ 14.01.2021" satisfies the
// local-number arm because "01" is a valid 0-prefix, "/ " are separators, and
// "14.01.2021" provides 8 digit-groups.  The standalone date check
// /^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}$/ does NOT catch it because the "01/"
// prefix defeats the ^ anchor.
// Fix: /\d{1,2}[./\-]\d{1,2}[./\-](19|20)\d{2}/ scans the display string for
// an embedded date with a 4-digit year regardless of what precedes it.
console.log('\nEmbedded-date / document-reference rejection');

// ── The exact bug case ────────────────────────────────────────────────────────
assertCount(
  '"01/ 14.01.2021" → 0  (ref prefix + date, not a phone)',
  '01/ 14.01.2021',
  0,
);

assertCount(
  '"01/14.01.2021" → 0  (run-together ref + date)',
  '01/14.01.2021',
  0,
);

// ── Related date formats ──────────────────────────────────────────────────────
assertCount(
  '"14.01.2021" → 0  (standalone date, caught by existing anchor check)',
  '14.01.2021',
  0,
);

assertCount(
  '"01-14.01.2021" → 0  (hyphen separator before date)',
  '01-14.01.2021',
  0,
);

assertCount(
  '"02/ 28.02.2024" → 0  (another ref + date combination)',
  '02/ 28.02.2024',
  0,
);

assertCount(
  '"15.03.2022" → 0  (date only, no ref prefix)',
  '15.03.2022',
  0,
);

// ── Document references (PHONE_RE does not match these at all) ────────────────
assertCount(
  '"Ref. 2024-001" → 0  (document reference — no 0-prefix match)',
  'Ref. 2024-001',
  0,
);

assertCount(
  '"Invoice #12345" → 0  (invoice number)',
  'Invoice #12345',
  0,
);

assertCount(
  '"Order №123456" → 0  (order number with Cyrillic №)',
  'Order №123456',
  0,
);

// ── Previously-accepted phones must still be accepted ────────────────────────
console.log('\nAccepted phones unaffected by date guard');

assertCount('"0898870562" → 1',               '0898870562',             1);
assertCount('"0898 870 562" → 1',             '0898 870 562',           1);
assertContains('"+359 888 870 562" → 1',      '+359 888 870 562',       '870');
assertContains('"+359 92 664265" → 1',        '+359 92 664265',         '664265');

// Mixed context: date and phone in the same text → only phone extracted
assert(
  'date and phone in same text → only phone kept',
  extractPhones('Издадена на: 14.01.2021\nТел: 0898 870 562'),
  ['0898 870 562'],
);

assert(
  'ref+date and phone in same text → only phone kept',
  extractPhones('Фактура: 01/ 14.01.2021\n+359 888 870 562'),
  ['+359 888 870 562'],
);

// Slash-separated phones that superficially resemble dates must NOT be rejected.
// "0893 / 35 41 42": "35" + "/" + "41" has no second [./\-] separator after "41"
// before a 4-digit year → embedded-date pattern does not fire.
assertCount(
  '"0893 / 35 41 42" → 1  (slash phone, not a date)',
  '0893 / 35 41 42',
  1,
);
assertCount(
  '"0877/86-62-18" → 1  (slash-hyphen phone, not a date)',
  '0877/86-62-18',
  1,
);

// Summary ─────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
