/**
 * Tests for AI-assisted email validation.
 *
 * validateEmails() calls Claude API with the page HTML and returns:
 *   - verified:   emails with confidence >= 70 (stored in profile)
 *   - unverified: emails with confidence < 70  (logged, not stored)
 *
 * Tests inject a mock callFn to avoid real API calls.
 *
 * Run with:  npx ts-node src/services/__tests__/emailValidation.test.ts
 */

import { validateEmails, selectPageForValidation } from '../emailValidation';
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

// Returns a mock callFn that always replies with the given JSON string
function mockCall(responseJson: string) {
  return async (_system: string, _user: string): Promise<string> => responseJson;
}

const MIN_HTML = ' '.repeat(101); // exceeds the 100-char threshold in selectPageForValidation

function makePage(url: string, html: string, emails: string[] = []): CrawledPage {
  // Pad non-empty html to exceed the 100-char threshold; empty strings stay empty.
  const paddedHtml = html.length > 0 && html.length <= 100
    ? html + MIN_HTML.slice(html.length)
    : html;
  return { url, text: '', html: paddedHtml, emails, phones: [], loginProtected: false, logoUrls: [] };
}

// ── selectPageForValidation ───────────────────────────────────────────────────

console.log('\nselectPageForValidation');

{
  const pages: CrawledPage[] = [
    makePage('https://example.com/', '<html>home</html>'),
    makePage('https://example.com/kontakti', '<html>contact</html>'),
    makePage('https://example.com/about', '<html>about</html>'),
  ];
  const page = selectPageForValidation(pages);
  assert('prefers contact URL', page?.url, 'https://example.com/kontakti');
}

{
  const pages: CrawledPage[] = [
    makePage('https://example.com/', '<html>home</html>', ['a@x.com']),
    makePage('https://example.com/services', '<html>services</html>', ['b@x.com', 'c@x.com']),
  ];
  const page = selectPageForValidation(pages);
  assert('falls back to page with most emails', page?.url, 'https://example.com/services');
}

{
  const page = selectPageForValidation([]);
  assert('no pages → undefined', page, undefined);
}

{
  const pages: CrawledPage[] = [
    makePage('https://example.com/', ''),  // empty html
    makePage('https://example.com/contact', ''),
  ];
  const page = selectPageForValidation(pages);
  assert('all pages empty html → undefined', page, undefined);
}

// ── validateEmails — verified emails (confidence >= 70) ───────────────────────

async function runIntegrationTests(): Promise<void> {

  console.log('\nvalidateEmails — high-confidence email → verified');

  {
    const response = JSON.stringify({
      emails: [
        {
          email: 'info@yotovstone.com',
          type: 'primary',
          personal_domain: false,
          domain_match: true,
          source_context: 'Contact us at info@yotovstone.com',
          confidence: 90,
        },
      ],
      no_emails_found: false,
    });

    const result = await validateEmails(
      'Yotov Stone',
      'yotovstone.com',
      'https://yotovstone.com/kontakti',
      '<html>Contact: info@yotovstone.com</html>',
      mockCall(response),
    );

    assertIncludes('verified contains high-confidence email', result.verified, 'info@yotovstone.com');
    assert('unverified is empty', result.unverified.length, 0);
    assert('no_emails_found is false', result.no_emails_found, false);
  }

  console.log('\nvalidateEmails — low-confidence email → unverified');

  {
    const response = JSON.stringify({
      emails: [
        {
          email: 'info@yotovstone.com',
          type: 'primary',
          personal_domain: false,
          domain_match: true,
          source_context: 'Some context',
          confidence: 50,
        },
      ],
      no_emails_found: false,
    });

    const result = await validateEmails(
      'Yotov Stone',
      'yotovstone.com',
      'https://yotovstone.com/kontakti',
      '<html>info@yotovstone.com</html>',
      mockCall(response),
    );

    assert('verified is empty (confidence 50 < 70)', result.verified.length, 0);
    assert('unverified has one entry', result.unverified.length, 1);
    assert('unverified email correct', result.unverified[0]?.email, 'info@yotovstone.com');
    assert('unverified confidence correct', result.unverified[0]?.confidence, 50);
  }

  console.log('\nvalidateEmails — Bulgarian personal domain (abv.bg) → verified if confidence ≥ 70');

  {
    const response = JSON.stringify({
      emails: [
        {
          email: 'firma123@abv.bg',
          type: 'personal',
          personal_domain: true,
          domain_match: false,
          source_context: 'Email: firma123@abv.bg',
          confidence: 75,
        },
      ],
      no_emails_found: false,
      notes: 'Only personal domain email found — no company domain email present',
    });

    const result = await validateEmails(
      'Firma BG',
      'firma-bg.com',
      'https://firma-bg.com/kontakti',
      '<html>firma123@abv.bg</html>',
      mockCall(response),
    );

    assertIncludes('abv.bg email verified when confidence ≥ 70', result.verified, 'firma123@abv.bg');
    assert('unverified is empty', result.unverified.length, 0);
    assert('notes propagated', typeof result.notes, 'string');
  }

  console.log('\nvalidateEmails — mixed confidence → correct split');

  {
    const response = JSON.stringify({
      emails: [
        { email: 'info@company.com',    type: 'primary',   personal_domain: false, domain_match: true,  source_context: 'footer', confidence: 95 },
        { email: 'sales@company.com',   type: 'secondary', personal_domain: false, domain_match: true,  source_context: 'footer', confidence: 80 },
        { email: 'old@company.com',     type: 'secondary', personal_domain: false, domain_match: true,  source_context: 'page',   confidence: 40 },
        { email: 'noreply@company.com', type: 'secondary', personal_domain: false, domain_match: true,  source_context: 'page',   confidence: 20 },
      ],
      no_emails_found: false,
    });

    const result = await validateEmails(
      'Company',
      'company.com',
      'https://company.com/contact',
      '<html>emails here</html>',
      mockCall(response),
    );

    assert('verified count (≥ 70)', result.verified.length, 2);
    assertIncludes('info@ verified', result.verified, 'info@company.com');
    assertIncludes('sales@ verified', result.verified, 'sales@company.com');
    assert('unverified count (< 70)', result.unverified.length, 2);
  }

  console.log('\nvalidateEmails — no emails found');

  {
    const response = JSON.stringify({
      emails: [],
      no_emails_found: true,
    });

    const result = await validateEmails(
      'Mystery Corp',
      'mystery.bg',
      'https://mystery.bg/',
      '<html>No email here</html>',
      mockCall(response),
    );

    assert('verified empty', result.verified.length, 0);
    assert('unverified empty', result.unverified.length, 0);
    assert('no_emails_found true', result.no_emails_found, true);
  }

  console.log('\nvalidateEmails — malformed JSON → safe fallback');

  {
    const result = await validateEmails(
      'Company',
      'company.com',
      'https://company.com/contact',
      '<html></html>',
      mockCall('This is not JSON at all'),
    );

    assert('verified empty on parse error', result.verified.length, 0);
    assert('no_emails_found true on parse error', result.no_emails_found, true);
  }

  console.log('\nvalidateEmails — response wrapped in markdown fences → still parsed');

  {
    const response = '```json\n' + JSON.stringify({
      emails: [
        { email: 'info@test.com', type: 'primary', personal_domain: false, domain_match: true, source_context: 'footer', confidence: 80 },
      ],
      no_emails_found: false,
    }) + '\n```';

    const result = await validateEmails(
      'Test',
      'test.com',
      'https://test.com/contact',
      '<html>info@test.com</html>',
      mockCall(response),
    );

    assertIncludes('markdown-fenced response parsed correctly', result.verified, 'info@test.com');
  }

  console.log('\nvalidateEmails — domain_mismatch email with high confidence → still verified');

  {
    const response = JSON.stringify({
      emails: [
        {
          email: 'info@yotovstones.com',
          type: 'primary',
          personal_domain: false,
          domain_match: false,
          source_context: 'Contact: info@yotovstones.com',
          confidence: 85,
          notes: 'domain typo — yotovstones.com vs yotovstone.com',
        },
      ],
      no_emails_found: false,
      notes: 'Possible domain typo detected',
    });

    const result = await validateEmails(
      'Yotov Stone',
      'yotovstone.com',
      'https://yotovstone.com/kontakti',
      '<html>info@yotovstones.com</html>',
      mockCall(response),
    );

    assertIncludes('domain_mismatch email verified if confidence ≥ 70', result.verified, 'info@yotovstones.com');
    assert('notes propagated', result.notes, 'Possible domain typo detected');
  }

  console.log('\nvalidateEmails — email casing normalised to lowercase');

  {
    const response = JSON.stringify({
      emails: [
        { email: 'INFO@Company.COM', type: 'primary', personal_domain: false, domain_match: true, source_context: '', confidence: 90 },
      ],
      no_emails_found: false,
    });

    const result = await validateEmails(
      'Company',
      'company.com',
      'https://company.com/',
      '<html>INFO@Company.COM</html>',
      mockCall(response),
    );

    assertIncludes('email normalised to lowercase', result.verified, 'info@company.com');
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

runIntegrationTests().then(() => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
