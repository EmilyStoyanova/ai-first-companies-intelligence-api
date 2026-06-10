/**
 * Integration tests for extractClickedContacts.
 *
 * Uses a real Playwright browser with page.setContent() so no HTTP server
 * is needed.  Each test injects a self-contained HTML fixture with inline
 * JavaScript that simulates click-to-modal behaviour.
 *
 * Run with:  npx ts-node src/lib/__tests__/teamInteraction.test.ts
 */

export {};

import { chromium, Browser, Page } from 'playwright';
import { extractClickedContacts, TEAM_CARD_SELECTORS } from '../teamInteraction';

let browser: Browser;
let page: Page;
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

function assertTruthy(label: string, value: unknown) {
  if (value) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}  (got falsy: ${JSON.stringify(value)})`);
    failed++;
  }
}

async function setup() {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
}

async function teardown() {
  await browser.close();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds a page with N staff-profile cards, each opening a dialog on click. */
function buildStaffPage(cards: Array<{ name: string; role: string; email: string; phone: string }>): string {
  const cardHtml = cards
    .map(
      (c, i) => `
      <div class="staff-profile" data-idx="${i}">
        <h3>${c.name}</h3>
        <p>${c.role}</p>
      </div>`,
    )
    .join('\n');

  const modalHtml = cards
    .map(
      (c, i) => `
      <div role="dialog" id="modal-${i}" style="display:none">
        <h4>${c.name}</h4>
        <p class="role">${c.role}</p>
        <a href="mailto:${c.email}">${c.email}</a>
        <a href="tel:${c.phone}">${c.phone}</a>
        <button class="btn-close" onclick="document.getElementById('modal-${i}').style.display='none'">×</button>
      </div>`,
    )
    .join('\n');

  const scriptHtml = cards
    .map(
      (_c, i) => `
      document.querySelector('[data-idx="${i}"]').addEventListener('click', function() {
        document.getElementById('modal-${i}').style.display = 'block';
      });`,
    )
    .join('\n');

  return `<html><body>${cardHtml}${modalHtml}<script>${scriptHtml}</script></body></html>`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function runTests() {
  await setup();

  // ── 1. Single card: email + phone extracted from modal ────────────────────
  console.log('\nSingle card → contact modal');

  await page.setContent(buildStaffPage([
    { name: 'Nelly Toncheva', role: 'Sales Manager', email: 'nelly.toncheva@alcomet.eu', phone: '+35954858615' },
  ]));

  {
    const contacts = await extractClickedContacts(page);
    assert('1 contact extracted',        contacts.length,   1);
    assert('name correct',               contacts[0]?.name,  'Nelly Toncheva');
    assert('email correct',              contacts[0]?.email, 'nelly.toncheva@alcomet.eu');
    assert('phone correct',              contacts[0]?.phone, '+35954858615');
    assert('position from modal',        contacts[0]?.position?.toLowerCase().includes('sales'), true);
  }

  // ── 2. Multiple cards: all contacts extracted in order ────────────────────
  console.log('\nMultiple cards → all contacts extracted');

  await page.setContent(buildStaffPage([
    { name: 'Ivan Petrov',  role: 'CEO',            email: 'ivan@company.bg',   phone: '+35988100001' },
    { name: 'Maria Stoyanova', role: 'CFO',         email: 'maria@company.bg',  phone: '+35988100002' },
    { name: 'Petar Dimitrov',  role: 'Sales Lead',  email: 'petar@company.bg',  phone: '+35988100003' },
  ]));

  {
    const contacts = await extractClickedContacts(page);
    assert('3 contacts extracted',                              contacts.length,    3);
    assert('first contact email',                              contacts[0]?.email,  'ivan@company.bg');
    assert('second contact email',                             contacts[1]?.email,  'maria@company.bg');
    assert('third contact email',                              contacts[2]?.email,  'petar@company.bg');
    assert('first contact name',                               contacts[0]?.name,   'Ivan Petrov');
    assert('third contact phone',                              contacts[2]?.phone,  '+35988100003');
  }

  // ── 3. No team cards → empty result, no errors ────────────────────────────
  console.log('\nPage with no team cards → empty result');

  await page.setContent(`
    <html><body>
      <h1>About Us</h1>
      <p>We are a great company.</p>
      <div class="services"><h3>Transport</h3><h3>Logistics</h3></div>
    </body></html>
  `);

  {
    const contacts = await extractClickedContacts(page);
    assert('no contacts on non-team page', contacts.length, 0);
  }

  // ── 4. Card with email only (no phone in modal) ───────────────────────────
  console.log('\nModal with email only (no tel link)');

  await page.setContent(`
    <html><body>
      <div class="staff-profile"><h3>Anna Ivanova</h3><p>Accountant</p></div>
      <div role="dialog" id="m" style="display:none">
        <p class="role">Accountant</p>
        <a href="mailto:anna@firm.bg">anna@firm.bg</a>
      </div>
      <script>
        document.querySelector('.staff-profile').addEventListener('click', function() {
          document.getElementById('m').style.display = 'block';
        });
      </script>
    </body></html>
  `);

  {
    const contacts = await extractClickedContacts(page);
    assert('1 contact (email only)',  contacts.length,    1);
    assert('email extracted',         contacts[0]?.email, 'anna@firm.bg');
    assert('phone undefined',         contacts[0]?.phone,  undefined);
  }

  // ── 5. Card with phone only (no email in modal) ───────────────────────────
  console.log('\nModal with phone only (no mailto link)');

  await page.setContent(`
    <html><body>
      <div class="team-member"><h3>Georgi Georgiev</h3><p>Director</p></div>
      <div role="dialog" id="m2" style="display:none">
        <p class="role">Director</p>
        <a href="tel:+35929991234">+359 29 991 234</a>
      </div>
      <script>
        document.querySelector('.team-member').addEventListener('click', function() {
          document.getElementById('m2').style.display = 'block';
        });
      </script>
    </body></html>
  `);

  {
    const contacts = await extractClickedContacts(page);
    assert('1 contact (phone only)',  contacts.length,    1);
    assert('phone extracted',         contacts[0]?.phone, '+35929991234');
    assert('email undefined',         contacts[0]?.email,  undefined);
  }

  // ── 6. Card with no contact links in modal → not added to results ─────────
  console.log('\nModal with no contact links → card skipped');

  await page.setContent(`
    <html><body>
      <div class="person-card"><h3>Test Person</h3><p>Engineer</p></div>
      <div role="dialog" id="m3" style="display:none">
        <p>Bio text only — no email or phone.</p>
      </div>
      <script>
        document.querySelector('.person-card').addEventListener('click', function() {
          document.getElementById('m3').style.display = 'block';
        });
      </script>
    </body></html>
  `);

  {
    const contacts = await extractClickedContacts(page);
    assert('0 contacts when no links in modal', contacts.length, 0);
  }

  // ── 7. No modal appears (card expands inline) — no crash ─────────────────
  console.log('\nNo modal appears (click does nothing detectable) → no crash');

  await page.setContent(`
    <html><body>
      <div class="employee-card"><h3>Static Person</h3><p>Manager</p></div>
    </body></html>
  `);

  {
    const contacts = await extractClickedContacts(page, { modalWaitMs: 200 });
    assert('no crash when modal never appears', Array.isArray(contacts), true);
    assert('empty result',                      contacts.length,         0);
  }

  // ── 8. maxCards limit is respected ───────────────────────────────────────
  console.log('\nmaxCards limit respected');

  await page.setContent(buildStaffPage([
    { name: 'Person One',   role: 'Role', email: 'one@co.bg',   phone: '+35900000001' },
    { name: 'Person Two',   role: 'Role', email: 'two@co.bg',   phone: '+35900000002' },
    { name: 'Person Three', role: 'Role', email: 'three@co.bg', phone: '+35900000003' },
    { name: 'Person Four',  role: 'Role', email: 'four@co.bg',  phone: '+35900000004' },
  ]));

  {
    const contacts = await extractClickedContacts(page, { maxCards: 2, modalWaitMs: 500 });
    assert('only 2 contacts extracted (maxCards=2)', contacts.length, 2);
    assert('first card processed',  contacts[0]?.email, 'one@co.bg');
    assert('second card processed', contacts[1]?.email, 'two@co.bg');
  }

  // ── 9. mailto query-string stripped ──────────────────────────────────────
  console.log('\nmailto query string stripped');

  await page.setContent(`
    <html><body>
      <div class="contact-card"><h3>Query Person</h3></div>
      <div role="dialog" id="qm" style="display:none">
        <a href="mailto:query@firm.bg?subject=Hello">query@firm.bg</a>
      </div>
      <script>
        document.querySelector('.contact-card').addEventListener('click', function() {
          document.getElementById('qm').style.display = 'block';
        });
      </script>
    </body></html>
  `);

  {
    const contacts = await extractClickedContacts(page, { modalWaitMs: 500 });
    assert('query string stripped from email', contacts[0]?.email, 'query@firm.bg');
  }

  // ── 10. TEAM_CARD_SELECTORS export covers all required selectors ──────────
  console.log('\nTEAM_CARD_SELECTORS contains required values');

  const requiredSelectors = [
    '.staff-profile',
    '.team-member',
    '.employee-card',
    '.person-card',
    '.contact-card',
  ];
  for (const sel of requiredSelectors) {
    assertTruthy(
      `TEAM_CARD_SELECTORS includes "${sel}"`,
      TEAM_CARD_SELECTORS.includes(sel),
    );
  }

  await teardown();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Fatal error:', err);
  browser?.close().catch(() => {});
  process.exit(1);
});
