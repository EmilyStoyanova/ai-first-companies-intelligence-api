/**
 * Standalone email extraction test runner.
 * No test framework required — run with:
 *   npx ts-node src/lib/__tests__/emailExtraction.test.ts
 */

import {
  extractEmails,
  extractEmailsFromHtml,
  extractSplitEmails,
  extractObfuscatedEmails,
  extractCloudflareEmails,
  extractEmailsFromAttributes,
  extractEmailsFromJsConcat,
  extractEmailsFromIframeSrcdoc,
  mergeEmails,
} from '../emailExtraction';

let passed = 0;
let failed = 0;

function assert(label: string, actual: string[], mustInclude: string[], mustExclude: string[] = []) {
  const norm = (e: string) => e.toLowerCase();
  const missing = mustInclude.filter((e) => !actual.some((a) => norm(a) === norm(e)));
  const present  = mustExclude.filter((e) => actual.some((a) => norm(a) === norm(e)));

  if (missing.length === 0 && present.length === 0) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    if (missing.length)  console.error(`       missing : ${missing.join(', ')}`);
    if (present.length)  console.error(`       spurious: ${present.join(', ')}`);
    console.error(`       got     : ${JSON.stringify(actual)}`);
    failed++;
  }
}

// Helper: encode an email using the Cloudflare XOR scheme (for test fixtures only)
function cfEncode(email: string, key = 0x24): string {
  let hex = key.toString(16).padStart(2, '0');
  for (const ch of email) {
    hex += (ch.charCodeAt(0) ^ key).toString(16).padStart(2, '0');
  }
  return hex;
}

// ── 1. Plain text ─────────────────────────────────────────────────────────────
console.log('\n1. Plain text emails');

assert('standard email in text',
  extractEmails('Contact us: office@company.bg'),
  ['office@company.bg'],
);

assert('Bulgarian institutional email (hyphenated, subdomain)',
  extractEmails('E-mail: info-609157@edv.mon.bg'),
  ['info-609157@edv.mon.bg'],
);

assert('email with dots in local-part',
  extractEmails('sales.bg@example-domain.com'),
  ['sales.bg@example-domain.com'],
);

// ── 2. mailto: links ──────────────────────────────────────────────────────────
console.log('\n2. mailto: links');

assert('simple mailto',
  extractEmailsFromHtml('<a href="mailto:office@company.bg">Пишете ни</a>'),
  ['office@company.bg'],
);

assert('mailto with query string (subject=...)',
  extractEmailsFromHtml('<a href="mailto:office@company.bg?subject=Запитване">Email</a>'),
  ['office@company.bg'],
);

assert('MAILTO uppercase href',
  extractEmailsFromHtml('<a href="MAILTO:info@school.bg">Контакти</a>'),
  ['info@school.bg'],
);

// ── 3. data-* attributes ──────────────────────────────────────────────────────
console.log('\n3. data-email / data-mail attributes');

assert('data-email attribute',
  extractEmailsFromHtml('<span data-email="info@kindergarten.bg">Click</span>'),
  ['info@kindergarten.bg'],
);

assert('data-mail attribute',
  extractEmailsFromHtml('<div data-mail="office@firm.bg"></div>'),
  ['office@firm.bg'],
);

// ── 4. HTML entity encoded ────────────────────────────────────────────────────
console.log('\n4. HTML entity encoded emails (decoded by Cheerio .text())');

assert('&#64; entity in page text (already decoded)',
  extractEmails('office@company.bg'),
  ['office@company.bg'],
);

// ── 5. Tag-split emails ───────────────────────────────────────────────────────
console.log('\n5. Tag-split emails (local-part@<tag>domain)');

assert('email split by <br/>',
  extractSplitEmails('contacts@<br />company.bg'),
  ['contacts@company.bg'],
);

assert('email split by <span> tag',
  extractSplitEmails('info@<span class="x">edv.mon.bg</span>'),
  ['info@edv.mon.bg'],
);

// ── 6. Obfuscated emails ──────────────────────────────────────────────────────
console.log('\n6. Obfuscated emails');

assert('[at] obfuscation',
  extractObfuscatedEmails('office[at]company.bg'),
  ['office@company.bg'],
);

assert('(at) obfuscation',
  extractObfuscatedEmails('office(at)company.bg'),
  ['office@company.bg'],
);

assert('{at} obfuscation',
  extractObfuscatedEmails('office{at}company.bg'),
  ['office@company.bg'],
);

assert('[dot] obfuscation',
  extractObfuscatedEmails('office[at]company[dot]bg'),
  ['office@company.bg'],
);

assert('(dot) obfuscation',
  extractObfuscatedEmails('office(at)company(dot)bg'),
  ['office@company.bg'],
);

assert('spaced @ between valid email chars',
  extractObfuscatedEmails('office @ company.bg'),
  ['office@company.bg'],
);

assert('spaced @ and dot: "name @ domain . tld"',
  extractObfuscatedEmails('office @ company . bg'),
  ['office@company.bg'],
);

assert('[at] with institutional email',
  extractObfuscatedEmails('info-609157[at]edv.mon.bg'),
  ['info-609157@edv.mon.bg'],
);

// ── 7. False positive rejection ───────────────────────────────────────────────
console.log('\n7. False positive rejection');

assert('example.bg filtered out',
  extractEmails('example@example.bg'),
  [],
  ['example@example.bg'],
);

assert('noreply filtered out',
  extractEmails('noreply@company.bg'),
  [],
  ['noreply@company.bg'],
);

assert('sentry.io filtered out',
  extractEmails('error@sentry.io'),
  [],
  ['error@sentry.io'],
);

// ── 8. Contact page scenario ──────────────────────────────────────────────────
console.log('\n8. Contact page scenario (phone + email on same page)');

const contactText = 'Телефон: 0887 123 456\nE-mail: director@school.bg\nАдрес: ул. Роза 12';
const contactHtml = `<p>Телефон: 0887 123 456</p>
<p>E-mail: <a href="mailto:director@school.bg">director@school.bg</a></p>
<p>Адрес: ул. Роза 12</p>`;

assert('mergeEmails finds email from contact page',
  mergeEmails(contactText, contactHtml),
  ['director@school.bg'],
);

// ── 9. Bulgarian mon.bg institutional emails ──────────────────────────────────
console.log('\n9. Bulgarian institutional emails');

assert('edv.mon.bg email accepted',
  mergeEmails('', '<a href="mailto:info-609157@edv.mon.bg">Контакти</a>'),
  ['info-609157@edv.mon.bg'],
);

assert('edu.mon.bg email accepted',
  mergeEmails('info-609161@edu.mon.bg', ''),
  ['info-609161@edu.mon.bg'],
);

// ── 10. Cloudflare email protection ──────────────────────────────────────────
console.log('\n10. Cloudflare email protection');

const cfOffice = cfEncode('office@company.bg');
assert('CF href form: /cdn-cgi/l/email-protection#ENCODED',
  extractCloudflareEmails(
    `<a href="/cdn-cgi/l/email-protection#${cfOffice}">Contact us</a>`,
  ),
  ['office@company.bg'],
);

assert('CF span form: <span data-cfemail="ENCODED">',
  extractCloudflareEmails(
    `<span class="__cf_email__" data-cfemail="${cfOffice}">[email protected]</span>`,
  ),
  ['office@company.bg'],
);

const cfInstitutional = cfEncode('info-609157@edv.mon.bg');
assert('CF decode preserves Bulgarian institutional email',
  extractCloudflareEmails(
    `<a href="/cdn-cgi/l/email-protection#${cfInstitutional}">Контакти</a>`,
  ),
  ['info-609157@edv.mon.bg'],
);

assert('CF junk domain still filtered after decode',
  extractCloudflareEmails(
    `<a href="/cdn-cgi/l/email-protection#${cfEncode('test@example.com')}">x</a>`,
  ),
  [],
  ['test@example.com'],
);

// ── 11. Extended attribute scanning ──────────────────────────────────────────
console.log('\n11. Extended attribute scanning');

assert('aria-label email',
  extractEmailsFromAttributes('<a aria-label="Send email to info@company.bg">✉</a>'),
  ['info@company.bg'],
);

assert('title attribute email',
  extractEmailsFromAttributes('<span title="office@company.bg">Hover me</span>'),
  ['office@company.bg'],
);

assert('image alt email',
  extractEmailsFromAttributes('<img src="icon.png" alt="office@company.bg">'),
  ['office@company.bg'],
);

assert('image title email',
  extractEmailsFromAttributes('<img src="icon.png" title="info@school.bg">'),
  ['info@school.bg'],
);

assert('meta content email',
  extractEmailsFromAttributes('<meta name="author" content="contact@company.bg">'),
  ['contact@company.bg'],
);

assert('input value email',
  extractEmailsFromAttributes('<input type="text" value="office@company.bg">'),
  ['office@company.bg'],
);

assert('data-contact attribute',
  extractEmailsFromAttributes('<div data-contact="sales@firm.bg"></div>'),
  ['sales@firm.bg'],
);

assert('data-value attribute',
  extractEmailsFromAttributes('<button data-value="info@company.bg">Send</button>'),
  ['info@company.bg'],
);

// ── 12. JavaScript string concatenation ──────────────────────────────────────
console.log('\n12. JavaScript string concatenation');

assert("single-quote concat: 'user' + '@' + 'domain.bg'",
  extractEmailsFromJsConcat(`var e = 'office' + '@' + 'company.bg';`),
  ['office@company.bg'],
);

assert('double-quote concat: "user"+"@"+"domain.bg"',
  extractEmailsFromJsConcat(`var e = "office"+"@"+"company.bg";`),
  ['office@company.bg'],
);

assert("entity concat: 'user' + '&#64;' + 'domain.bg'",
  extractEmailsFromJsConcat(`var e = 'office' + '&#64;' + 'company.bg';`),
  ['office@company.bg'],
);

assert('mixed quotes concat',
  extractEmailsFromJsConcat(`var e = 'office' + "@" + 'company.bg';`),
  ['office@company.bg'],
);

assert('institutional email in JS concat',
  extractEmailsFromJsConcat(`var e = 'info-609157' + '@' + 'edv.mon.bg';`),
  ['info-609157@edv.mon.bg'],
);

// ── 13. Inline iframe srcdoc ──────────────────────────────────────────────────
console.log('\n13. Inline iframe srcdoc');

assert('email in srcdoc text',
  extractEmailsFromIframeSrcdoc(
    `<iframe srcdoc="<p>Contact: director@school.bg</p>"></iframe>`,
  ),
  ['director@school.bg'],
);

assert('email in srcdoc mailto link',
  extractEmailsFromIframeSrcdoc(
    `<iframe srcdoc='<a href="mailto:info@company.bg">Email</a>'></iframe>`,
  ),
  ['info@company.bg'],
);

assert('CF email in srcdoc',
  extractEmailsFromIframeSrcdoc(
    `<iframe srcdoc='<span data-cfemail="${cfOffice}">[email protected]</span>'></iframe>`,
  ),
  ['office@company.bg'],
);

// ── 14. mergeEmails integration ───────────────────────────────────────────────
console.log('\n14. mergeEmails integration (all sources combined)');

const cfEncoded = cfEncode('cf@company.bg');
const richHtml = `
<html>
<head>
  <meta name="contact" content="meta@company.bg">
</head>
<body>
  <p>Plain: plain@company.bg</p>
  <a href="mailto:mailto@company.bg">Mail</a>
  <a href="/cdn-cgi/l/email-protection#${cfEncoded}">CF</a>
  <img alt="img@company.bg" />
  <iframe srcdoc="<p>iframe@company.bg</p>"></iframe>
</body>
</html>`;

const result = mergeEmails('', richHtml);
assert('all sources in one page',
  result,
  ['plain@company.bg', 'mailto@company.bg', 'cf@company.bg', 'img@company.bg', 'iframe@company.bg', 'meta@company.bg'],
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
