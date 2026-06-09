/**
 * Tests for email extraction — false-positive guards and valid-email coverage.
 *
 * Root cause of the asset-filename false positive:
 *   EMAIL_RE is permissive by design (must match obfuscated, split, and attribute
 *   emails).  "logo-footer@2x.png" satisfies it because:
 *     local part  → "logo-footer"  matches [a-zA-Z0-9._%+\-]+
 *     domain      → "2x"           matches [a-zA-Z0-9.\-]+  (digits allowed)
 *     TLD         → "png"          matches [a-zA-Z]{2,}
 *   Fix: filterEmails() rejects any email whose TLD (last segment after '.')
 *   is a known media / code file extension (JUNK_TLD_EXTENSIONS).
 *
 * Run with:  npx ts-node src/lib/__tests__/extractEmails.test.ts
 */

export {}; // make this file a module (avoids global-scope variable collision)

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  filterEmails,
  extractEmails,
  extractEmailsFromHtml,
  extractEmailsFromAttributes,
  mergeEmails,
  truncateAtTldBoundary,
} = require('../emailExtraction') as typeof import('../emailExtraction');

let passed = 0;
let failed = 0;

function assertKept(label: string, emails: string[], expected: string[]) {
  const got = JSON.stringify([...emails].sort());
  const want = JSON.stringify([...expected].sort());
  if (got === want) {
    console.log(`  ✓  ${label}  →  ${JSON.stringify(emails)}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       got:      ${got}`);
    console.error(`       expected: ${want}`);
    failed++;
  }
}

function assertEmpty(label: string, emails: string[]) {
  assertKept(label, emails, []);
}

// ── filterEmails: asset filename false positives ──────────────────────────────
console.log('\nasset filename false positives — filterEmails must reject');

// Retina-scale image filename patterns (@2x, @3x)
assertEmpty('logo-footer@2x.png',   filterEmails(['logo-footer@2x.png']));
assertEmpty('logo@2x.png',          filterEmails(['logo@2x.png']));
assertEmpty('icon@3x.webp',         filterEmails(['icon@3x.webp']));
assertEmpty('sprite@2x.svg',        filterEmails(['sprite@2x.svg']));

// All required extensions from the spec
assertEmpty('.jpg extension',        filterEmails(['background@dark.jpg']));
assertEmpty('.jpeg extension',       filterEmails(['photo@large.jpeg']));
assertEmpty('.webp extension',       filterEmails(['hero@optimized.webp']));
assertEmpty('.gif extension',        filterEmails(['loading@spin.gif']));
assertEmpty('.ico extension',        filterEmails(['favicon@16.ico']));
assertEmpty('.css extension',        filterEmails(['styles@bundle.css']));
assertEmpty('.js extension',         filterEmails(['app@main.js']));
assertEmpty('.svg extension',        filterEmails(['icon@menu.svg']));

// Case insensitive TLD
assertEmpty('.PNG uppercase',        filterEmails(['LOGO@2X.PNG']));
assertEmpty('.JPG uppercase',        filterEmails(['image@full.JPG']));

// Multiple values — only the filename is rejected, real email is kept
assertKept(
  'mixed list: one filename + one real email',
  filterEmails(['logo@2x.png', 'office@company.bg']),
  ['office@company.bg'],
);

// ── filterEmails: valid emails must survive ───────────────────────────────────
console.log('\nvalid emails — filterEmails must keep');

assertKept('office@company.bg',              filterEmails(['office@company.bg']),              ['office@company.bg']);
assertKept('info-609157@edv.mon.bg',         filterEmails(['info-609157@edv.mon.bg']),         ['info-609157@edv.mon.bg']);
assertKept('maria.asenova@yotovstone.com',   filterEmails(['maria.asenova@yotovstone.com']),   ['maria.asenova@yotovstone.com']);
assertKept('info@example-company.bg',        filterEmails(['info@example-company.bg']),        ['info@example-company.bg']);
assertKept('support@subdomain.company.eu',   filterEmails(['support@subdomain.company.eu']),   ['support@subdomain.company.eu']);
assertKept('55n_milanov@tdm-plast.com',      filterEmails(['55n_milanov@tdm-plast.com']),      ['55n_milanov@tdm-plast.com']);

// ── extractEmails: full text pipeline ────────────────────────────────────────
console.log('\nextractEmails — text pipeline');

assertEmpty(
  'filename in plain text is rejected',
  extractEmails('The image is logo-footer@2x.png on this page.'),
);

assertEmpty(
  'multiple filenames in text — all rejected',
  extractEmails('assets: logo@2x.png icon@3x.webp sprite@dark.svg'),
);

assertKept(
  'real email in text is extracted',
  extractEmails('Contact us at office@company.bg for more info.'),
  ['office@company.bg'],
);

assertKept(
  'real email kept when filename also present in same text',
  extractEmails('Logo: logo@2x.png  Email: info@serpio.bg'),
  ['info@serpio.bg'],
);

// ── extractEmailsFromHtml: HTML pipeline ─────────────────────────────────────
console.log('\nextractEmailsFromHtml — HTML pipeline');

assertEmpty(
  'data-email with filename is rejected',
  extractEmailsFromHtml('<span data-email="logo@2x.png"></span>'),
);

assertKept(
  'mailto href with real email is kept',
  extractEmailsFromHtml('<a href="mailto:contact@firma.bg">Email us</a>'),
  ['contact@firma.bg'],
);

assertKept(
  'data-email with real email is kept',
  extractEmailsFromHtml('<span data-email="info@serpio.bg"></span>'),
  ['info@serpio.bg'],
);

// ── extractEmailsFromAttributes: img attributes ───────────────────────────────
console.log('\nextractEmailsFromAttributes — img alt/title scanning');

assertEmpty(
  'img alt containing filename is rejected',
  extractEmailsFromAttributes('<img src="logo-footer@2x.png" alt="logo-footer@2x.png">'),
);

assertKept(
  'img alt containing real email is kept',
  extractEmailsFromAttributes('<img alt="contact: office@company.bg">'),
  ['office@company.bg'],
);

// ── mergeEmails: end-to-end ───────────────────────────────────────────────────
console.log('\nmergeEmails — end-to-end with HTML + text');

assertEmpty(
  'filename in both text and HTML — rejected end-to-end',
  mergeEmails(
    'The site logo is logo-footer@2x.png',
    '<html><body><img src="logo-footer@2x.png" alt="logo-footer@2x.png"></body></html>',
  ),
);

assertKept(
  'real email via mailto and text is deduplicated to one entry',
  mergeEmails(
    'Email: info@firma.bg',
    '<html><body><a href="mailto:info@firma.bg">info@firma.bg</a></body></html>',
  ),
  ['info@firma.bg'],
);

// ── TLD boundary truncation: truncateAtTldBoundary ───────────────────────────
// Direct unit tests for the truncation helper.
console.log('\ntruncateAtTldBoundary — TLD boundary clipping');

function assertTrunc(label: string, input: string, expected: string) {
  const got = truncateAtTldBoundary(input);
  if (got === expected) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       got:      ${JSON.stringify(got)}`);
    console.error(`       expected: ${JSON.stringify(expected)}`);
    failed++;
  }
}

// All three patterns from the spec
assertTrunc('comOUR   → com',      'office@yotovstone.comOUR',    'office@yotovstone.com');
assertTrunc('bgContacts → bg',     'info@firma.bgContacts',       'info@firma.bg');
assertTrunc('comAbout → com',      'sales@serpio.comAbout',       'sales@serpio.com');

// Valid emails must be unchanged
assertTrunc('subdomain unchanged',  'info@sub.company.bg',         'info@sub.company.bg');
assertTrunc('hyphen domain',        'sales.office@example-domain.com', 'sales.office@example-domain.com');
assertTrunc('all-lowercase TLD',    'maria@firma.com',             'maria@firma.com');

// Edge: TLD all-uppercase (not mixed) — must not truncate, safety-net handles
assertTrunc('all-uppercase TLD unchanged', 'user@domain.COM',      'user@domain.COM');

// ── filterEmails: text-bleed produces the valid email, not a rejection ─────────
console.log('\nfilterEmails — text-bleed truncation (not rejection)');

// The critical behaviour: the valid email is KEPT after truncation
assertKept(
  'office@yotovstone.comOUR → office@yotovstone.com (kept)',
  filterEmails(['office@yotovstone.comOUR']),
  ['office@yotovstone.com'],
);
assertKept(
  'info@firma.bgContacts → info@firma.bg (kept)',
  filterEmails(['info@firma.bgContacts']),
  ['info@firma.bg'],
);
assertKept(
  'sales@serpio.comAbout → sales@serpio.com (kept)',
  filterEmails(['sales@serpio.comAbout']),
  ['sales@serpio.com'],
);

// Multiple emails in one call — bleed versions → clean versions, no duplicates
assertKept(
  'bleed version and clean version → deduped to one entry',
  filterEmails(['office@yotovstone.comOUR', 'office@yotovstone.com']),
  ['office@yotovstone.com'],
);

// Valid subdomain / hyphenated emails survive unchanged
assertKept(
  'info@sub.company.bg unchanged',
  filterEmails(['info@sub.company.bg']),
  ['info@sub.company.bg'],
);
assertKept(
  'sales.office@example-domain.com unchanged',
  filterEmails(['sales.office@example-domain.com']),
  ['sales.office@example-domain.com'],
);

// ── extractEmails: text pipeline with bleed ───────────────────────────────────
console.log('\nextractEmails — text pipeline with bleed text');

assertKept(
  'office@yotovstone.comOUR in plain text → clean email extracted',
  extractEmails('Contact: office@yotovstone.comOUR TEAM section'),
  ['office@yotovstone.com'],
);

assertKept(
  'info@firma.bgКонтакти (Cyrillic bleed) → info@firma.bg extracted',
  // Cyrillic chars are not in [a-zA-Z] so EMAIL_RE stops at the TLD boundary
  // naturally; this just confirms no regression
  extractEmails('info@firma.bg и Контакти'),
  ['info@firma.bg'],
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
