/**
 * Tests for AI-assisted services/activities validation.
 *
 * validateServices() receives already-extracted page text and returns:
 *   - services:           list of extracted service/product strings
 *   - represented_brands: brands the company distributes/represents
 *   - primary_industry:   top-level industry label
 *   - target_customers:   who they sell to
 *
 * Tests inject a mock callFn to avoid real API calls.
 *
 * Run with:  npx ts-node src/services/__tests__/servicesValidation.test.ts
 */

import { validateServices, selectServicesPages } from '../servicesValidation';
import type { CrawledPage } from '../../worker/crawl';

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

function assertIncludes(label: string, arr: string[], value: string) {
  if (arr.includes(value)) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}  (array=${JSON.stringify(arr)} does not include "${value}")`);
    failed++;
  }
}

function mockCall(responseJson: string) {
  return async (_system: string, _user: string): Promise<string> => responseJson;
}

const STUB_TEXT = 'Предлагаме строителни услуги, ремонти и довършителни работи за жилищни и промишлени обекти.';

function makePage(url: string, text: string): CrawledPage {
  return { url, text, html: '', emails: [], phones: [], loginProtected: false, logoUrls: [] };
}

// ── selectServicesPages ───────────────────────────────────────────────────────

console.log('\nselectServicesPages');

{
  const pages: CrawledPage[] = [
    makePage('https://example.com/', 'Начало на сайта, добре дошли на нашата страница с обща информация.'),
    makePage('https://example.com/uslug', 'Предлагаме широк спектър от услуги за нашите клиенти в страната и чужбина.'),
    makePage('https://example.com/about', 'За нас. Фирмата е основана през 2005 г. и работи в строителния бранш.'),
  ];
  const result = selectServicesPages(pages);
  assert('prefers services URL (uslug)', result[0]?.url, 'https://example.com/uslug');
}

{
  const pages: CrawledPage[] = [
    makePage('https://example.com/', 'Начало на сайта, добре дошли на нашата страница с обща информация.'),
    makePage('https://example.com/products', 'Продукти и стоки, предлагани от нашата фирма на конкурентни цени.'),
  ];
  const result = selectServicesPages(pages);
  assert('prefers products URL', result[0]?.url, 'https://example.com/products');
}

{
  const pages: CrawledPage[] = [
    makePage('https://example.com/', 'a'.repeat(200)),
    makePage('https://example.com/blog', 'b'.repeat(3000)),
  ];
  const result = selectServicesPages(pages);
  assert('falls back to page with most text when no URL match', result[0]?.url, 'https://example.com/blog');
}

{
  const result = selectServicesPages([]);
  assert('no pages → empty array', result.length, 0);
}

{
  const pages: CrawledPage[] = [
    makePage('https://example.com/', ''),
    makePage('https://example.com/services', ''),
  ];
  const result = selectServicesPages(pages);
  assert('all empty text → empty array', result.length, 0);
}

{
  const pages: CrawledPage[] = [
    makePage('https://example.com/', 'Начало на сайта, добре дошли на нашата страница с обща информация.'),
    makePage('https://example.com/services', 'Услуги: строителство, ремонт, довършване на обекти в страната и чужбина.'),
    makePage('https://example.com/about', 'За нас. Фирмата е основана през 2005 г. и работи в строителния бранш.'),
    makePage('https://example.com/blog', 'Блог статии и новини от строителния сектор за нашите читатели.'),
  ];
  const result = selectServicesPages(pages);
  assert('returns at most 2 pages', result.length <= 2, true);
  assert('top result is services URL', result[0]?.url, 'https://example.com/services');
}

// ── validateServices ─────────────────────────────────────────────────────────

async function runTests(): Promise<void> {

  console.log('\nvalidateServices — high-confidence response → services extracted');

  {
    const result = await validateServices(
      'Стоун Строй',
      'stonstroy.com',
      'https://stonstroy.com/uslug',
      STUB_TEXT,
      mockCall(JSON.stringify({
        services: ['Строителство на жилищни сгради', 'Ремонтни дейности', 'Довършителни работи'],
        represented_brands: [],
        primary_industry: 'Construction',
        target_customers: 'Частни лица и строителни инвеститори',
        no_services_found: false,
        confidence: 80,
      })),
    );

    assert('services count', result.services.length, 3);
    assertIncludes('includes строителство', result.services, 'Строителство на жилищни сгради');
    assert('primary_industry', result.primary_industry, 'Construction');
    assert('no_services_found false', result.no_services_found, false);
    assertGte('confidence ≥ 50', result.confidence, 50);
  }

  console.log('\nvalidateServices — confidence below threshold (< 35) → empty result');

  {
    const result = await validateServices(
      'Company',
      'company.bg',
      'https://company.bg/',
      STUB_TEXT,
      mockCall(JSON.stringify({
        services: ['Some service'],
        represented_brands: [],
        no_services_found: false,
        confidence: 20,
      })),
    );

    assert('services empty (below threshold)', result.services.length, 0);
    assert('no_services_found true', result.no_services_found, true);
    assert('confidence preserved', result.confidence, 20);
  }

  console.log('\nvalidateServices — represented_brands extracted for distributor');

  {
    const result = await validateServices(
      'ТехноМакс',
      'technomax.bg',
      'https://technomax.bg/products',
      STUB_TEXT,
      mockCall(JSON.stringify({
        services: ['Продажба на климатична техника', 'Монтаж и сервиз'],
        represented_brands: ['Daikin', 'Mitsubishi Electric', 'LG'],
        primary_industry: 'HVAC',
        target_customers: 'B2B клиенти и крайни потребители',
        no_services_found: false,
        confidence: 75,
      })),
    );

    assert('represented_brands count', result.represented_brands.length, 3);
    assertIncludes('Daikin in brands', result.represented_brands, 'Daikin');
    assert('target_customers', result.target_customers, 'B2B клиенти и крайни потребители');
  }

  console.log('\nvalidateServices — no services found');

  {
    const result = await validateServices(
      'Mystery Corp',
      'mystery.bg',
      'https://mystery.bg/',
      STUB_TEXT,
      mockCall(JSON.stringify({ services: [], represented_brands: [], no_services_found: true, confidence: 60 })),
    );

    assert('services empty', result.services.length, 0);
    assert('no_services_found true', result.no_services_found, true);
  }

  console.log('\nvalidateServices — malformed JSON → safe fallback');

  {
    const result = await validateServices(
      'Company',
      'company.bg',
      'https://company.bg/',
      STUB_TEXT,
      mockCall('Not valid JSON'),
    );

    assert('services empty on parse error', result.services.length, 0);
    assert('no_services_found true on parse error', result.no_services_found, true);
  }

  console.log('\nvalidateServices — markdown-fenced response → still parsed');

  {
    const inner = JSON.stringify({
      services: ['Уеб дизайн', 'SEO оптимизация'],
      represented_brands: [],
      primary_industry: 'IT Services',
      target_customers: 'МСП',
      no_services_found: false,
      confidence: 70,
    });

    const result = await validateServices(
      'WebAgency',
      'webagency.bg',
      'https://webagency.bg/services',
      STUB_TEXT,
      mockCall('```json\n' + inner + '\n```'),
    );

    assert('markdown fences stripped', result.primary_industry, 'IT Services');
    assert('services parsed', result.services.length, 2);
  }

  console.log('\nvalidateServices — notes propagated');

  {
    const result = await validateServices(
      'Company',
      'company.bg',
      'https://company.bg/',
      STUB_TEXT,
      mockCall(JSON.stringify({
        services: ['Търговия с хранителни стоки'],
        represented_brands: [],
        no_services_found: false,
        confidence: 65,
        notes: 'Services page was very sparse',
      })),
    );

    assert('notes propagated', result.notes, 'Services page was very sparse');
  }

  console.log('\nvalidateServices — empty strings in services array are filtered out');

  {
    const result = await validateServices(
      'Company',
      'company.bg',
      'https://company.bg/',
      STUB_TEXT,
      mockCall(JSON.stringify({
        services: ['Valid service', '', '  ', 'Another service'],
        represented_brands: ['', 'Real Brand'],
        no_services_found: false,
        confidence: 70,
      })),
    );

    assert('empty strings filtered from services', result.services.length, 2);
    assert('empty strings filtered from brands', result.represented_brands.length, 1);
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
