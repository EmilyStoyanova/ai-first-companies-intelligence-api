/**
 * Tests for Strategy 7: personal company-domain email → team member inference.
 *
 * Root cause of the empty-team bug:
 *   Strategies 4 & 5 both require a role label to be present near the email
 *   or text pattern.  A simple list of personal company-domain emails (like
 *   vtashev@, toni@, nina@) produces no team members even though the email
 *   local parts are clearly person names.
 *
 *   Strategy 7 catches these by scanning page.emails for non-generic company-
 *   domain locals and inferring a display name from the local part when safe.
 *
 * Run with:  npx ts-node src/services/__tests__/extractTeamEmails.test.ts
 */

import { inferNameFromLocal, GENERIC_EMAIL_LOCALS, extractProfile } from '../extraction';

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
  emails: string[] = [],
  url = 'https://tashev-trans.com/',
): Parameters<typeof extractProfile>[0][0] {
  return { url, html, text: '', emails, phones: [], loginProtected: false, logoUrls: [] };
}

// ── inferNameFromLocal unit tests ─────────────────────────────────────────────

console.log('\ninferNameFromLocal — personal emails → name inferred');

// Single first names (clear first-name pattern)
assert('toni → Toni',             inferNameFromLocal('toni'),             'Toni');
assert('nina → Nina',             inferNameFromLocal('nina'),             'Nina');
assert('nasko → Nasko',           inferNameFromLocal('nasko'),            'Nasko');
assert('tzvety → Tzvety',         inferNameFromLocal('tzvety'),           'Tzvety');
assert('plamen → Plamen',         inferNameFromLocal('plamen'),           'Plamen');
assert('kristian → Kristian',     inferNameFromLocal('kristian'),         'Kristian');
assert('zhivko → Zhivko',         inferNameFromLocal('zhivko'),           'Zhivko');
assert('tsveta → Tsveta',         inferNameFromLocal('tsveta'),           'Tsveta');

// Dot-separated first.last → "First Last"
assert('maria.asenova → Maria Asenova', inferNameFromLocal('maria.asenova'), 'Maria Asenova');
assert('ivan.petrov → Ivan Petrov',     inferNameFromLocal('ivan.petrov'),   'Ivan Petrov');
assert('john.doe → John Doe',           inferNameFromLocal('john.doe'),      'John Doe');

// Underscore-separated first_last → "First Last"
assert('ivan_petrov → Ivan Petrov',     inferNameFromLocal('ivan_petrov'),   'Ivan Petrov');

// Trailing digit suffix stripped before inference
assert('toni2 → Toni',                  inferNameFromLocal('toni2'),          'Toni');
assert('nina3 → Nina',                  inferNameFromLocal('nina3'),          'Nina');

console.log('\ninferNameFromLocal — initial+surname pattern → undefined (email only)');

// Initial+surname pattern (first char consonant + second char consonant, not a valid cluster)
assert('vtashev → undefined',  inferNameFromLocal('vtashev'),  undefined);
assert('bgenchev → undefined', inferNameFromLocal('bgenchev'), undefined);
assert('mtodorov → undefined', inferNameFromLocal('mtodorov'), undefined);
assert('ngeorgiev → undefined', inferNameFromLocal('ngeorgiev'), undefined);

console.log('\ninferNameFromLocal — generic department emails → undefined');

// Generic mailboxes must all return undefined
assert('info → undefined',       inferNameFromLocal('info'),       undefined);
assert('office → undefined',     inferNameFromLocal('office'),     undefined);
assert('sales → undefined',      inferNameFromLocal('sales'),      undefined);
assert('accounting → undefined', inferNameFromLocal('accounting'), undefined);
assert('manager → undefined',    inferNameFromLocal('manager'),    undefined);
assert('marketing → undefined',  inferNameFromLocal('marketing'),  undefined);
assert('factory → undefined',    inferNameFromLocal('factory'),    undefined);
assert('orders → undefined',     inferNameFromLocal('orders'),     undefined);
assert('admin → undefined',      inferNameFromLocal('admin'),      undefined);
assert('support → undefined',    inferNameFromLocal('support'),    undefined);
assert('hr → undefined',         inferNameFromLocal('hr'),         undefined);
assert('billing → undefined',    inferNameFromLocal('billing'),    undefined);
assert('tech → undefined',       inferNameFromLocal('tech'),       undefined);
assert('noreply → undefined',    inferNameFromLocal('noreply'),    undefined);
assert('webmaster → undefined',  inferNameFromLocal('webmaster'),  undefined);

// ── GENERIC_EMAIL_LOCALS set coverage ────────────────────────────────────────

console.log('\nGENERIC_EMAIL_LOCALS — contains expected entries');

assert('has info',        GENERIC_EMAIL_LOCALS.has('info'),        true);
assert('has office',      GENERIC_EMAIL_LOCALS.has('office'),      true);
assert('has sales',       GENERIC_EMAIL_LOCALS.has('sales'),       true);
assert('has hr',          GENERIC_EMAIL_LOCALS.has('hr'),          true);
assert('has noreply',     GENERIC_EMAIL_LOCALS.has('noreply'),     true);
assert('lacks toni',      GENERIC_EMAIL_LOCALS.has('toni'),        false);
assert('lacks nina',      GENERIC_EMAIL_LOCALS.has('nina'),        false);

// ── Integration: Strategy 7 creates team members from personal emails ─────────

console.log('\nStrategy 7 integration — personal emails become team members');

{
  // tashev-trans.com scenario: 5 personal emails, no HTML team section
  const page = makePage(
    '<html><head><title>Tashev Trans</title></head><body><p>Contact us</p></body></html>',
    [
      'vtashev@tashev-trans.com',
      'tzvety@tashev-trans.com',
      'toni@tashev-trans.com',
      'nasko@tashev-trans.com',
      'nina@tashev-trans.com',
    ],
    'https://tashev-trans.com/',
  );
  const profile = extractProfile([page]);

  assert('team is non-empty', profile.team.length > 0, true);

  // toni, nina, nasko, tzvety should all get names
  const namedMembers = profile.team.filter((m) => m.name !== undefined);
  assert('at least 3 named members (toni/nina/nasko/tzvety)', namedMembers.length >= 3, true);

  const toni = profile.team.find((m) => m.email === 'toni@tashev-trans.com');
  assert('toni → name: Toni', toni?.name, 'Toni');

  const nina = profile.team.find((m) => m.email === 'nina@tashev-trans.com');
  assert('nina → name: Nina', nina?.name, 'Nina');

  const nasko = profile.team.find((m) => m.email === 'nasko@tashev-trans.com');
  assert('nasko → name: Nasko', nasko?.name, 'Nasko');

  const tzvety = profile.team.find((m) => m.email === 'tzvety@tashev-trans.com');
  assert('tzvety → name: Tzvety', tzvety?.name, 'Tzvety');

  // vtashev: initial+surname pattern → email-only entry (name undefined)
  const vtashev = profile.team.find((m) => m.email === 'vtashev@tashev-trans.com');
  assert('vtashev → email-only (name undefined)', vtashev?.name, undefined);
  assert('vtashev → email present', vtashev?.email, 'vtashev@tashev-trans.com');
}

console.log('\nStrategy 7 integration — generic emails are not team members');

{
  const page = makePage(
    '<html><head><title>Company</title></head><body></body></html>',
    [
      'info@example-company.bg',
      'office@example-company.bg',
      'sales@example-company.bg',
    ],
    'https://example-company.bg/',
  );
  const profile = extractProfile([page]);
  assert('generic-only emails → team is empty', profile.team.length, 0);
}

console.log('\nStrategy 7 integration — first.last email becomes full name');

{
  const page = makePage(
    '<html><head><title>Company</title></head><body></body></html>',
    ['maria.asenova@example-company.bg'],
    'https://example-company.bg/',
  );
  const profile = extractProfile([page]);
  assert('first.last → full name', profile.team[0]?.name, 'Maria Asenova');
  assert('first.last → email preserved', profile.team[0]?.email, 'maria.asenova@example-company.bg');
}

console.log('\nStrategy 7 integration — public domain emails ignored');

{
  const page = makePage(
    '<html><head><title>Company</title></head><body></body></html>',
    ['toni@gmail.com', 'nina@yahoo.com'],
    'https://example-company.bg/',
  );
  const profile = extractProfile([page]);
  assert('public provider emails not added to team', profile.team.length, 0);
}

console.log('\nStrategy 7 integration — no duplicates with Strategy 5 (mailto+role)');

{
  // Strategy 5 should capture this (role label present); Strategy 7 must not add a second entry
  const page = makePage(
    '<html><head><title>Company</title></head><body>' +
      '<div><a href="mailto:toni@example-company.bg">toni@example-company.bg</a>' +
      ' — <span>Управител</span></div>' +
    '</body></html>',
    ['toni@example-company.bg'],
    'https://example-company.bg/',
  );
  const profile = extractProfile([page]);
  const toniEntries = profile.team.filter((m) => m.email === 'toni@example-company.bg');
  assert('toni appears only once (no Strategy 5 + Strategy 7 duplicate)', toniEntries.length, 1);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
