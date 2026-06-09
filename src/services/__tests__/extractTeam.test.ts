/**
 * Tests for team extraction helpers: isPersonName, matchRoleLabel,
 * and the full extractTeam pipeline via mock CrawledPage fixtures.
 *
 * Run with:  npx ts-node src/services/__tests__/extractTeam.test.ts
 */

export {}; // make this file a module so `passed`/`failed` don't collide with other test files

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractProfile } = require('../extraction') as typeof import('../extraction');

let passed = 0;
let failed = 0;

function assert(label: string, actual: boolean, expected: boolean) {
  if (actual === expected) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}  (got ${actual}, want ${expected})`);
    failed++;
  }
}

function assertTeam(
  label: string,
  html: string,
  text: string,
  check: (team: Array<{ name?: string; position?: string; email?: string }>) => boolean,
) {
  const profile = extractProfile([
    { url: 'https://example.com/contacts', html, text, emails: [], phones: [], loginProtected: false, logoUrls: [] },
  ]);
  const ok = check(profile.team as Array<{ name?: string; position?: string; email?: string }>);
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}  (team=${JSON.stringify(profile.team)})`);
    failed++;
  }
}

// ── isPersonName (via extraction outcome) ─────────────────────────────────────
console.log('\nStrategy 4 — text pattern "ROLE: Name"');

assertTeam(
  'BG "Управител: Иван Иванов"',
  '<html><body></body></html>',
  'Управител: Иван Иванов',
  (t) => t.some((m) => m.name === 'Иван Иванов' && /управител/i.test(m.position ?? '')),
);

assertTeam(
  'EN "CEO: John Smith"',
  '<html><body></body></html>',
  'CEO: John Smith',
  (t) => t.some((m) => m.name === 'John Smith' && /ceo/i.test(m.position ?? '')),
);

assertTeam(
  'BG "Директор: Мария Петрова"',
  '<html><body></body></html>',
  'Директор: Мария Петрова',
  (t) => t.some((m) => m.name === 'Мария Петрова'),
);

assertTeam(
  'EN "Manager: Maria Petrova"',
  '<html><body></body></html>',
  'Manager: Maria Petrova',
  (t) => t.some((m) => m.name === 'Maria Petrova'),
);

assertTeam(
  'BG "Счетоводител: Стефан Дичев"',
  '<html><body></body></html>',
  'Счетоводител: Стефан Дичев',
  (t) => t.some((m) => m.name === 'Стефан Дичев'),
);

console.log('\nStrategy 4 — text pattern "Name — ROLE"');

assertTeam(
  'BG "Иван Иванов - управител"',
  '<html><body></body></html>',
  'Иван Иванов - управител',
  (t) => t.some((m) => m.name === 'Иван Иванов' && /управител/i.test(m.position ?? '')),
);

assertTeam(
  'EN "John Smith - CEO"',
  '<html><body></body></html>',
  'John Smith - CEO',
  (t) => t.some((m) => m.name === 'John Smith'),
);

assertTeam(
  'EN "Maria Santos — Sales Manager"',
  '<html><body></body></html>',
  'Maria Santos — Sales Manager',
  (t) => t.some((m) => m.name === 'Maria Santos'),
);

assertTeam(
  'EN "Managing Director - Ivan Petrov"',
  '<html><body></body></html>',
  'Managing Director - Ivan Petrov',
  (t) => t.some((m) => m.name === 'Ivan Petrov'),
);

console.log('\nStrategy 1 — structured name+role card (HTML)');

assertTeam(
  'Card with class "team-member"',
  `<html><body>
    <div class="team-member">
      <h3>Georgi Georgiev</h3>
      <p class="role">Sales Director</p>
    </div>
  </body></html>`,
  'Georgi Georgiev Sales Director',
  (t) => t.some((m) => m.name === 'Georgi Georgiev' && /sales director/i.test(m.position ?? '')),
);

assertTeam(
  'Card with class "person-card"',
  `<html><body>
    <div class="person-card">
      <h4>Петър Стоянов</h4>
      <span class="position">Управител</span>
    </div>
  </body></html>`,
  'Петър Стоянов Управител',
  (t) => t.some((m) => /петър/i.test(m.name ?? '')),
);

console.log('\nStrategy 5 — role + email via mailto link');

assertTeam(
  'mailto near "управител"',
  `<html><body>
    <div>
      <span>Управител</span>
      <a href="mailto:ivan@example.com">ivan@example.com</a>
    </div>
  </body></html>`,
  'Управител ivan@example.com',
  (t) => t.some((m) => m.email === 'ivan@example.com' && /управител/i.test(m.position ?? '')),
);

assertTeam(
  'mailto near "CEO"',
  `<html><body>
    <p>CEO: <a href="mailto:ceo@company.com">ceo@company.com</a></p>
  </body></html>`,
  'CEO: ceo@company.com',
  (t) => t.some((m) => m.email === 'ceo@company.com'),
);

console.log('\nFalse-positive guards — must NOT produce team members');

assertTeam(
  'Company name alone "CrossCycle"',
  '<html><body><h1>CrossCycle</h1></body></html>',
  'CrossCycle',
  (t) => t.length === 0,
);

assertTeam(
  'Nav items only',
  '<html><body><nav><a>Начало</a><a>За нас</a><a>Контакти</a></nav></body></html>',
  'Начало За нас Контакти',
  (t) => t.length === 0,
);

assertTeam(
  'Services list (no role labels)',
  '<html><body><ul><li>Транспорт</li><li>Логистика</li></ul></body></html>',
  'Транспорт и логистика',
  (t) => t.length === 0,
);

assertTeam(
  'Single-word name rejected (no role pair)',
  '<html><body></body></html>',
  'Иван',
  (t) => !t.some((m) => m.name === 'Иван'),
);

assertTeam(
  'Company suffix in "name" rejected',
  '<html><body></body></html>',
  'Управител: Техникерамик ООД',
  (t) => !t.some((m) => /ооод/i.test(m.name ?? '')),
);

assertTeam(
  'Colon line with non-role left side',
  '<html><body></body></html>',
  'Адрес: ул. Иван Вазов 5',
  (t) => t.length === 0,
);

console.log('\nCyrillic names');

assertTeam(
  '"Собственик: Стефан Стефанов"',
  '<html><body></body></html>',
  'Собственик: Стефан Стефанов',
  (t) => t.some((m) => m.name === 'Стефан Стефанов'),
);

assertTeam(
  '"Мениджър продажби: Мария Атанасова"',
  '<html><body></body></html>',
  'Мениджър продажби: Мария Атанасова',
  (t) => t.some((m) => m.name === 'Мария Атанасова'),
);

console.log('\nLatin names');

assertTeam(
  '"Owner: Robert Johnson"',
  '<html><body></body></html>',
  'Owner: Robert Johnson',
  (t) => t.some((m) => m.name === 'Robert Johnson'),
);

assertTeam(
  '"Financial Director: Elena Kovacheva"',
  '<html><body></body></html>',
  'Financial Director: Elena Kovacheva',
  (t) => t.some((m) => m.name === 'Elena Kovacheva'),
);

// ── Quality gate: demo / template detection ───────────────────────────────────
// Helper: build a page with Cyrillic body text so siteScript() returns 'cyrillic'.
const CYRILLIC_BODY = 'Нашата компания предлага качествени строителни услуги в цяла България. ' +
  'Ние сме специализирани в ремонти, строителство и довършителни работи. ' +
  'Свържете се с нас за повече информация относно нашите услуги и цени.';

function bgPage(html: string, extra = ''): { url: string; html: string; text: string; emails: string[]; phones: string[]; loginProtected: boolean; logoUrls: string[] } {
  return {
    url: 'https://serpio.bg/',
    html,
    text: CYRILLIC_BODY + ' ' + extra,
    emails: [],
    phones: [],
    loginProtected: false,
    logoUrls: [],
  };
}

console.log('\nQuality gate — demo/template detection');

// 1. Demo template: Latin names, Cyrillic site, no company email → rejected
assertTeam(
  'Demo S1 cards: Latin names on BG site, no company email → empty',
  `<html><body>
    <div class="team-member"><h3>John Portman</h3><p class="role">Manager</p></div>
    <div class="team-member"><h3>Kelley Miles</h3><p class="role">Engineer</p></div>
    <div class="team-member"><h3>Sherman Warner</h3><p class="role">Brewer</p></div>
  </body></html>`,
  CYRILLIC_BODY + ' Our Team John Portman Manager Kelley Miles Engineer Sherman Warner Brewer',
  (t) => t.length === 0,
);

// 2. English placeholder names on Bulgarian site (Strategy 2 heading path) → rejected
assertTeam(
  'Demo S2: heading "Our Team" + Latin names on BG site → empty',
  `<html><body>
    <section>
      <h2>Our Team</h2>
      <div><h3>Alice Walker</h3><p>Designer</p></div>
      <div><h3>Bob Martin</h3><p>Developer</p></div>
    </section>
  </body></html>`,
  CYRILLIC_BODY + ' Our Team Alice Walker Designer Bob Martin Developer',
  (t) => t.filter((m) => m.name === 'Alice Walker' || m.name === 'Bob Martin').length === 0,
);

// 3. Real Bulgarian team page: Cyrillic names with role labels → kept
assertTeam(
  'Real BG S1 cards: Cyrillic names + role labels → extracted',
  `<html><body>
    <div class="team-member"><h3>Иван Петров</h3><p class="role">Управител</p></div>
    <div class="team-member"><h3>Мария Стоянова</h3><p class="role">Счетоводител</p></div>
  </body></html>`,
  CYRILLIC_BODY + ' Иван Петров Управител Мария Стоянова Счетоводител',
  (t) => t.some((m) => m.name === 'Иван Петров') && t.some((m) => m.name === 'Мария Стоянова'),
);

// 4. Company-domain email overrides language mismatch: Latin name + BG site but company email → kept
assertTeam(
  'Latin name on BG site + company-domain email → kept',
  `<html><body>
    <div class="team-member">
      <h3>John Smith</h3>
      <p>CEO</p>
      <a href="mailto:john@serpio.bg">john@serpio.bg</a>
    </div>
  </body></html>`,
  CYRILLIC_BODY + ' John Smith CEO john@serpio.bg',
  (t) => t.some((m) => m.name === 'John Smith'),
);

// 5. Leadership page with real management team (text-pattern S4) → kept
assertTeam(
  'Leadership page: real BG management via text-pattern → extracted',
  '<html><body></body></html>',
  CYRILLIC_BODY + '\nУправител: Стефан Дончев\nТърговски директор: Петър Василев',
  (t) => t.some((m) => m.name === 'Стефан Дончев') && t.some((m) => m.name === 'Петър Василев'),
);

// 6. About page with no real team (just company description) → empty
assertTeam(
  'About page with no people data → empty',
  `<html><body>
    <h2>За нас</h2>
    <p>Фирмата е основана през 2005 г. и предлага широка гама от услуги.</p>
  </body></html>`,
  'За нас Фирмата е основана през 2005 г. и предлага широка гама от услуги.',
  (t) => t.length === 0,
);

// 7. Mixed section: one Cyrillic + one Latin name on BG site → keep both
//    (presence of a Cyrillic name signals the section is real)
assertTeam(
  'Mixed Cyrillic+Latin names on BG site → both kept',
  `<html><body>
    <div class="team-member"><h3>Иван Иванов</h3><p class="role">Управител</p></div>
    <div class="team-member"><h3>John Smith</h3><p class="role">CTO</p></div>
  </body></html>`,
  CYRILLIC_BODY + ' Иван Иванов Управител John Smith CTO',
  (t) => t.some((m) => m.name === 'Иван Иванов') && t.some((m) => m.name === 'John Smith'),
);

// 8. Latin-language site with Latin demo names — language mismatch gate does NOT trigger
//    (gate only fires on Cyrillic sites); but isPersonName still filters non-names
assertTeam(
  'Latin site with Latin team cards → kept (no language mismatch)',
  `<html><body>
    <div class="team-member"><h3>Alice Johnson</h3><p class="role">CEO</p></div>
    <div class="team-member"><h3>Robert Davis</h3><p class="role">CFO</p></div>
  </body></html>`,
  'Our company. Alice Johnson CEO Robert Davis CFO',
  (t) => t.some((m) => m.name === 'Alice Johnson') && t.some((m) => m.name === 'Robert Davis'),
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
