/**
 * Tests for AI-assisted address validation.
 *
 * validateAddress() calls Claude API with pre-extracted candidates from two sources
 * (website and search) and returns:
 *   - primary:     highest-confidence address (confidence ≥ 60) with source label
 *   - alternative: optional second address if sources differ
 *
 * Tests inject a mock callFn to avoid real API calls.
 *
 * Run with:  npx ts-node src/services/__tests__/addressValidation.test.ts
 */

import { validateAddress } from '../addressValidation';

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

function mockCall(responseJson: string) {
  return async (_system: string, _user: string): Promise<string> => responseJson;
}

// ── validateAddress tests ─────────────────────────────────────────────────────

async function runTests(): Promise<void> {

  console.log('\nvalidateAddress — website address with high confidence → primary source=website');

  {
    const result = await validateAddress(
      'Yotov Stone',
      'yotovstone.com',
      'бул. Стефан Стамболов 5, 3000 Враца',
      [],
      mockCall(JSON.stringify({
        primary: {
          full_address: 'бул. Стефан Стамболов 5, 3000 Враца',
          source: 'website',
          confidence: 90,
        },
        no_address_found: false,
      })),
    );

    assert('primary is set', !!result.primary, true);
    assert('full_address correct', result.primary?.full_address, 'бул. Стефан Стамболов 5, 3000 Враца');
    assert('source is website', result.primary?.source, 'website');
    assertGte('confidence ≥ 60', result.primary?.confidence ?? 0, 60);
    assert('no_address_found false', result.no_address_found, false);
    assert('alternative undefined', result.alternative, undefined);
  }

  console.log('\nvalidateAddress — no website address, search candidate available → primary source=search');

  {
    const result = await validateAddress(
      'Mystery Corp',
      'mystery.bg',
      '',
      ['ул. Иван Вазов 12, 1000 София'],
      mockCall(JSON.stringify({
        primary: {
          full_address: 'ул. Иван Вазов 12, 1000 София',
          source: 'search',
          confidence: 75,
        },
        no_address_found: false,
      })),
    );

    assert('primary is set', !!result.primary, true);
    assert('full_address correct', result.primary?.full_address, 'ул. Иван Вазов 12, 1000 София');
    assert('source is search', result.primary?.source, 'search');
    assert('no_address_found false', result.no_address_found, false);
  }

  console.log('\nvalidateAddress — website and search differ → website primary, search alternative');

  {
    const result = await validateAddress(
      'Big Corp',
      'bigcorp.bg',
      'бул. Цар Освободител 45, 4000 Пловдив',
      ['ул. Иван Вазов 12, 1000 София'],
      mockCall(JSON.stringify({
        primary: {
          full_address: 'бул. Цар Освободител 45, 4000 Пловдив',
          source: 'website',
          confidence: 85,
        },
        alternative: {
          full_address: 'ул. Иван Вазов 12, 1000 София',
          source: 'search',
          confidence: 70,
          note: 'Found via search — differs from website address',
        },
        no_address_found: false,
      })),
    );

    assert('primary is website address', result.primary?.full_address, 'бул. Цар Освободител 45, 4000 Пловдив');
    assert('primary source website', result.primary?.source, 'website');
    assert('alternative is search address', result.alternative?.full_address, 'ул. Иван Вазов 12, 1000 София');
    assert('alternative source search', result.alternative?.source, 'search');
    assert('alternative note set', typeof result.alternative?.note, 'string');
  }

  console.log('\nvalidateAddress — confidence below threshold (< 60) → primary undefined');

  {
    const result = await validateAddress(
      'Company',
      'company.com',
      'Sofia, Bulgaria',
      [],
      mockCall(JSON.stringify({
        primary: {
          full_address: 'Sofia, Bulgaria',
          source: 'website',
          confidence: 45,
        },
        no_address_found: false,
      })),
    );

    assert('primary undefined (below threshold)', result.primary, undefined);
    assert('no_address_found true', result.no_address_found, true);
  }

  console.log('\nvalidateAddress — alternative below threshold → alternative not returned');

  {
    const result = await validateAddress(
      'Company',
      'company.bg',
      'бул. Стефан Стамболов 5, 3000 Враца',
      ['Some weak candidate'],
      mockCall(JSON.stringify({
        primary: {
          full_address: 'бул. Стефан Стамболов 5, 3000 Враца',
          source: 'website',
          confidence: 80,
        },
        alternative: {
          full_address: 'Some weak candidate',
          source: 'search',
          confidence: 40,
        },
        no_address_found: false,
      })),
    );

    assert('primary set', !!result.primary, true);
    assert('alternative undefined (below threshold)', result.alternative, undefined);
  }

  console.log('\nvalidateAddress — no address found');

  {
    const result = await validateAddress(
      'Mystery Corp',
      'mystery.bg',
      '',
      [],
      mockCall(JSON.stringify({ no_address_found: true })),
    );

    assert('primary undefined', result.primary, undefined);
    assert('no_address_found true', result.no_address_found, true);
  }

  console.log('\nvalidateAddress — malformed JSON → safe fallback');

  {
    const result = await validateAddress(
      'Company',
      'company.bg',
      '',
      [],
      mockCall('Not JSON'),
    );

    assert('primary undefined', result.primary, undefined);
    assert('no_address_found true', result.no_address_found, true);
  }

  console.log('\nvalidateAddress — markdown-fenced response → still parsed');

  {
    const inner = JSON.stringify({
      primary: {
        full_address: 'ул. Васил Левски 10, 5000 Велико Търново',
        source: 'website',
        confidence: 80,
      },
      no_address_found: false,
    });

    const result = await validateAddress(
      'VT Company',
      'vtcompany.bg',
      'ул. Васил Левски 10, 5000 Велико Търново',
      [],
      mockCall('```json\n' + inner + '\n```'),
    );

    assert('markdown fences stripped', result.primary?.full_address, 'ул. Васил Левски 10, 5000 Велико Търново');
    assert('source preserved', result.primary?.source, 'website');
  }

  console.log('\nvalidateAddress — notes propagated');

  {
    const result = await validateAddress(
      'Company',
      'company.bg',
      'ул. Тест 1, 1000 София',
      [],
      mockCall(JSON.stringify({
        primary: {
          full_address: 'ул. Тест 1, 1000 София',
          source: 'website',
          confidence: 70,
        },
        no_address_found: false,
        notes: 'Address found in footer only',
      })),
    );

    assert('notes propagated', result.notes, 'Address found in footer only');
  }

  console.log('\nvalidateAddress — multiple search candidates passed → primary from search');

  {
    const result = await validateAddress(
      'No Site Corp',
      'nosite.bg',
      '',
      [
        'бул. Стефан Стамболов 5, 3000 Враца',
        'ул. Тест 12, 1000 София',
        'Some Street 1, 2000 Пловдив',
      ],
      mockCall(JSON.stringify({
        primary: {
          full_address: 'бул. Стефан Стамболов 5, 3000 Враца',
          source: 'search',
          confidence: 82,
        },
        no_address_found: false,
      })),
    );

    assert('primary set from search', result.primary?.full_address, 'бул. Стефан Стамболов 5, 3000 Враца');
    assert('source is search', result.primary?.source, 'search');
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

runTests().then(() => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
