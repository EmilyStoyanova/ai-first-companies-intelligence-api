/**
 * Tests for isGenericAuthName and the extractCompanyName fallback chain
 * (tested via extractProfile with mock CrawledPage fixtures).
 * Run with:  npx ts-node src/services/__tests__/isGenericAuthName.test.ts
 */

import { isGenericAuthName, extractProfile } from '../extraction';

// Minimal CrawledPage factory for name-extraction tests
function makePage(html: string, url = 'https://example.com/'): Parameters<typeof extractProfile>[0][0] {
  return { url, html, text: '', emails: [], phones: [], loginProtected: false, logoUrls: [] };
}

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

// ── Language-switcher labels — expected: true ────────────────────────────────
console.log('\nLanguage-switcher labels — expected: true (never a company name)');

// Exact strings already in the set (regression guard)
assert('english version (exact set entry)',  isGenericAuthName('english version'),   true);
assert('English version (capitalised)',      isGenericAuthName('English version'),   true);
assert('ENGLISH VERSION (all caps)',         isGenericAuthName('ENGLISH VERSION'),   true);
assert('bg version',                         isGenericAuthName('bg version'),         true);
assert('en version',                         isGenericAuthName('en version'),         true);
assert('bg',                                 isGenericAuthName('bg'),                 true);
assert('en',                                 isGenericAuthName('en'),                 true);

// Previously-missing [code] version patterns (caught by LANG_SWITCH_RE)
assert('de version',                         isGenericAuthName('de version'),         true);
assert('fr version',                         isGenericAuthName('fr version'),         true);
assert('ru version',                         isGenericAuthName('ru version'),         true);
assert('DE VERSION (all caps)',              isGenericAuthName('DE VERSION'),         true);

// Previously-missing [full name] version patterns
assert('bulgarian version',                  isGenericAuthName('bulgarian version'),  true);
assert('Bulgarian version (capitalised)',    isGenericAuthName('Bulgarian version'),  true);
assert('german version',                     isGenericAuthName('german version'),     true);
assert('french version',                     isGenericAuthName('french version'),     true);
assert('spanish version',                    isGenericAuthName('spanish version'),    true);
assert('romanian version',                   isGenericAuthName('romanian version'),   true);

// Action labels — switch/select/change language
assert('switch language',                    isGenericAuthName('switch language'),    true);
assert('Switch Language (capitalised)',      isGenericAuthName('Switch Language'),    true);
assert('SWITCH LANGUAGE (all caps)',         isGenericAuthName('SWITCH LANGUAGE'),   true);
assert('select language',                    isGenericAuthName('select language'),    true);
assert('change language',                    isGenericAuthName('change language'),    true);
assert('choose language',                    isGenericAuthName('choose language'),    true);
assert('switch lang',                        isGenericAuthName('switch lang'),        true);

// "language switch/switcher/selector/…" (reversed word order)
assert('language switch',                    isGenericAuthName('language switch'),    true);
assert('language switcher',                  isGenericAuthName('language switcher'),  true);
assert('language selector',                  isGenericAuthName('language selector'),  true);
assert('language picker',                    isGenericAuthName('language picker'),    true);
assert('language menu',                      isGenericAuthName('language menu'),      true);
assert('language toggle',                    isGenericAuthName('language toggle'),    true);

// Standalone language names (ISO codes + English names)
assert('english (standalone)',               isGenericAuthName('english'),            true);
assert('English (capitalised)',              isGenericAuthName('English'),            true);
assert('bulgarian (standalone)',             isGenericAuthName('bulgarian'),          true);
assert('Bulgarian',                          isGenericAuthName('Bulgarian'),          true);
assert('german',                             isGenericAuthName('german'),             true);
assert('deutsch',                            isGenericAuthName('deutsch'),            true);
assert('Deutsch',                            isGenericAuthName('Deutsch'),            true);
assert('français',                           isGenericAuthName('français'),           true);
assert('español',                            isGenericAuthName('español'),            true);
assert('de (ISO code)',                      isGenericAuthName('de'),                 true);
assert('fr (ISO code)',                      isGenericAuthName('fr'),                 true);
assert('ru (ISO code)',                      isGenericAuthName('ru'),                 true);

// Normalisation: hyphens collapsed before check
assert('switch-language (hyphen)',           isGenericAuthName('switch-language'),   true);
assert('de-version (hyphen)',               isGenericAuthName('de-version'),         true);
assert('english-version (hyphen)',          isGenericAuthName('english-version'),    true);

// ── Should return TRUE (generic auth names) ───────────────────────────────────
console.log('\nGeneric auth names — expected: true');

assert('login',                    isGenericAuthName('login'),                    true);
assert('Login (capitalised)',      isGenericAuthName('Login'),                    true);
assert('LOGIN (all caps)',         isGenericAuthName('LOGIN'),                    true);
assert('log in (spaced)',          isGenericAuthName('log in'),                   true);
assert('Sign In',                  isGenericAuthName('Sign In'),                  true);
assert('sign-in (hyphen)',         isGenericAuthName('sign-in'),                  true);
assert('signin (no space)',        isGenericAuthName('signin'),                   true);
assert('Вход (Cyrillic)',          isGenericAuthName('Вход'),                     true);
assert('ВХОД (all caps)',          isGenericAuthName('ВХОД'),                     true);
assert('Влизане',                  isGenericAuthName('Влизане'),                  true);
assert('portal',                   isGenericAuthName('portal'),                   true);
assert('Portal',                   isGenericAuthName('Portal'),                   true);
assert('customer portal',          isGenericAuthName('customer portal'),          true);
assert('customer-portal (hyphen)', isGenericAuthName('customer-portal'),          true);
assert('Customer Portal',          isGenericAuthName('Customer Portal'),          true);
assert('client area',              isGenericAuthName('client area'),              true);
assert('dealer portal',            isGenericAuthName('dealer portal'),            true);
assert('member area',              isGenericAuthName('member area'),              true);
assert('my account',               isGenericAuthName('my account'),               true);
assert('account',                  isGenericAuthName('account'),                  true);
assert('welcome',                  isGenericAuthName('welcome'),                  true);
assert('Welcome',                  isGenericAuthName('Welcome'),                  true);
assert('dashboard',                isGenericAuthName('dashboard'),                true);
assert('Dashboard',                isGenericAuthName('Dashboard'),                true);
assert('forgot password',          isGenericAuthName('forgot password'),          true);
assert('authentication',           isGenericAuthName('authentication'),           true);
assert('auth',                     isGenericAuthName('auth'),                     true);
assert('admin',                    isGenericAuthName('admin'),                    true);
assert('  login  (whitespace)',    isGenericAuthName('  login  '),                true);
// Generic home / landing page labels (Latin)
assert('home',                     isGenericAuthName('home'),                     true);
assert('Home (capitalised)',       isGenericAuthName('Home'),                     true);
assert('HOME (all caps)',          isGenericAuthName('HOME'),                     true);
assert('homepage',                 isGenericAuthName('homepage'),                 true);
assert('Homepage',                 isGenericAuthName('Homepage'),                 true);
assert('home page (spaced)',       isGenericAuthName('Home Page'),                true);
assert('index',                    isGenericAuthName('index'),                    true);
assert('Index',                    isGenericAuthName('Index'),                    true);
assert('main',                     isGenericAuthName('main'),                     true);
assert('main page',                isGenericAuthName('main page'),                true);
assert('landing',                  isGenericAuthName('landing'),                  true);
assert('landing page',             isGenericAuthName('landing page'),             true);
assert('Landing page',             isGenericAuthName('Landing page'),             true);
assert('start',                    isGenericAuthName('start'),                    true);
assert('start page',               isGenericAuthName('start page'),               true);
assert('untitled',                 isGenericAuthName('untitled'),                 true);
assert('untitled document',        isGenericAuthName('untitled document'),        true);
assert('new page',                 isGenericAuthName('new page'),                 true);
// Generic home / landing page labels (Cyrillic Bulgarian)
assert('Начална страница',         isGenericAuthName('Начална страница'),         true);
assert('НАЧАЛНА СТРАНИЦА',         isGenericAuthName('НАЧАЛНА СТРАНИЦА'),         true);
assert('Начало',                   isGenericAuthName('Начало'),                   true);
assert('Добре дошли',              isGenericAuthName('Добре дошли'),              true);
assert('Добре дошли!',             isGenericAuthName('Добре дошли!'),             true);

// ── Should return FALSE (real company/brand names) ────────────────────────────
console.log('\nReal company names — expected: false');

assert('CrossCycle',               isGenericAuthName('CrossCycle'),               false);
assert('Yotov Stone',              isGenericAuthName('Yotov Stone'),              false);
assert('Ташев Транс ООД',          isGenericAuthName('Ташев Транс ООД'),          false);
assert('Techceramic M',            isGenericAuthName('Techceramic M'),            false);
assert('ХУБЕВ',                    isGenericAuthName('ХУБЕВ'),                    false);
assert('Walltopia',                isGenericAuthName('Walltopia'),                false);
assert('PREDSEDNIK LTD',           isGenericAuthName('PREDSEDNIK LTD'),           false);
assert('Chaos',                    isGenericAuthName('Chaos'),                    false);
assert('Vratsa Stone',             isGenericAuthName('Vratsa Stone'),             false);
assert('SoftUni',                  isGenericAuthName('SoftUni'),                  false);
assert('undefined (falsy)',        isGenericAuthName(undefined),                  false);
assert('null (falsy)',             isGenericAuthName(null),                       false);
assert('empty string',            isGenericAuthName(''),                         false);

// Names that CONTAIN a language keyword but are not switcher labels
assert('English & Sons (multi-word, non-version)', isGenericAuthName('English & Sons'),         false);
assert('Bulgarian Rose Ltd',                       isGenericAuthName('Bulgarian Rose Ltd'),     false);
assert('German Auto Parts',                        isGenericAuthName('German Auto Parts'),      false);
assert('English School Sofia',                     isGenericAuthName('English School Sofia'),   false);
assert('New German Bridge',                        isGenericAuthName('New German Bridge'),      false);
assert('Switch Networks (not language)',            isGenericAuthName('Switch Networks'),        false);
assert('Select Solutions (not language)',           isGenericAuthName('Select Solutions'),       false);
// "version" alone is not a language-switch label
assert('version alone',                            isGenericAuthName('version'),                false);
// Chehplast domain name — what the fallback should return
assert('Chehplast (domain-derived)',               isGenericAuthName('Chehplast'),              false);

// ── extractCompanyName fallback chain (via extractProfile) ────────────────────
console.log('\nextractCompanyName fallback chain');

function assertName(label: string, pages: Parameters<typeof extractProfile>[0], expected: string | undefined) {
  const profile = extractProfile(pages);
  const got = profile.name;
  if (got === expected) {
    console.log(`  ✓  ${label}  →  ${JSON.stringify(got)}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       got:      ${JSON.stringify(got)}`);
    console.error(`       expected: ${JSON.stringify(expected)}`);
    failed++;
  }
}

// Priority 1: og:site_name wins over a generic title
assertName(
  'generic title + og:site_name → uses og:site_name',
  [makePage(
    '<html><head>' +
      '<title>Начална страница</title>' +
      '<meta property="og:site_name" content="Tashev Trans">' +
      '</head><body></body></html>',
    'https://tashev-trans.bg/',
  )],
  'Tashev Trans',
);

// Priority 2: logo alt text when og:site_name absent
assertName(
  'generic title + no og:site_name + logo img alt → uses logo alt',
  [makePage(
    '<html><head><title>Home</title></head>' +
      '<body><header><a href="/"><img class="site-logo" alt="CrossCycle"></a></header></body></html>',
    'https://crosscycle.bg/',
  )],
  'CrossCycle',
);

// Priority 4: domain-derived name when all richer sources are exhausted
assertName(
  'generic title + no og:site_name + no logo alt → domain-derived name',
  [makePage(
    '<html><head><title>Начало</title></head><body></body></html>',
    'https://yotovstone.bg/',
  )],
  'Yotovstone',
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
