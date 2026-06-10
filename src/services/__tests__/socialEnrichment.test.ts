/**
 * Unit tests for the social-link confidence scoring used by enrichSocialLinks.
 *
 * Root cause of the wrong-social-link bug:
 *   isHighConfidence accepted the FIRST matching signal (URL slug substring OR
 *   any company-name word > 4 chars in title) and returned true immediately.
 *   A 5-letter common word like "cross" in the company name matched any result
 *   title that happened to contain that word — e.g. "Cross Schools Bluffton"
 *   matched for domain "crosscycle.com".
 *
 * Fix: signal-based scoring (≥ 2 required).  A single short-word title match
 *   is worth 1 point and therefore never sufficient alone.
 *
 * Run with:  npx ts-node src/services/__tests__/socialEnrichment.test.ts
 */

import { scoreConfidence, isHighConfidence } from '../socialEnrichment';

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

// ── scoreConfidence unit tests ────────────────────────────────────────────────

console.log('\nScoring — URL slug signals');

// Exact domain-base match → 2 pts
assert(
  'exact slug = domain base → score 2',
  scoreConfidence('https://www.facebook.com/yotovstone', 'Random Page', undefined, undefined, 'yotovstone.com'),
  2,
);

// Slug is prefix of domain base → 2 pts (threshold: domain base length ≥ 6)
assert(
  'slug is prefix of domain base (len ≥ 6) → score 2',
  scoreConfidence('https://www.linkedin.com/company/starck-technology', undefined, undefined, undefined, 'starck.tech'),
  2,
);

// Domain base is prefix of slug (brand + suffix) → 2 pts
assert(
  'domain base is prefix of slug → score 2',
  scoreConfidence('https://www.facebook.com/crosscyclebikes', undefined, undefined, undefined, 'crosscycle.com'),
  2,
);

// Substring only (>= 7 chars domain) → 1 pt
assert(
  'substring match for long domain (>= 7 chars) → score 1',
  scoreConfidence('https://www.facebook.com/mycrosscycle', undefined, undefined, undefined, 'crosscycle.com'),
  1,
);

// Prefix check disabled for domain base < 6 chars — "cross" should not match
// "crossschoolsbluffton" via prefix because "cross" is too short/common.
assert(
  'prefix check disabled for domain base < 6 chars → score 0',
  scoreConfidence('https://www.facebook.com/crossschoolsbluffton', undefined, undefined, undefined, 'cross.com'),
  0,
);

console.log('\nScoring — company name signals');

// Full name (≥ 5 chars) in title → +1
assert(
  'full company name in title → +1',
  scoreConfidence('https://www.facebook.com/unrelated', 'Yotov Stone | Facebook', undefined, 'Yotov Stone', 'yotovstone.com'),
  1,
);

// Full name match (≥ 5 chars) in title → +1.  Long-word check does NOT double-count
// when the full name already matched (else-branch design).
assert(
  'full name match in title → +1 (no double-count with long-word check)',
  scoreConfidence('https://www.linkedin.com/company/unrelated', 'Walltopia | LinkedIn', undefined, 'Walltopia', 'walltopia.com'),
  1,
);

// "Cross" (5 chars) in title counts as full-name match (+1) but there is no second
// signal (slug mismatch, no snippet) → total score 1, below the 2-point threshold.
assert(
  'short company name "Cross" in title → score 1 (single signal, below threshold)',
  scoreConfidence('https://www.facebook.com/crossschoolsbluffton', 'Cross Schools Bluffton | Facebook', undefined, 'Cross', 'crosscycle.com'),
  1,
);

// Short 5-letter company name match adds 1 pt, but slug mismatch → total 1 (below threshold)
assert(
  '"Cross" name match alone → score 1, not enough to accept',
  scoreConfidence('https://www.facebook.com/crossschoolsbluffton', 'Cross Schools Bluffton | Facebook', undefined, 'CrossCycle', 'crosscycle.com'),
  0,
);

console.log('\nScoring — domain in snippet');

// Domain in snippet → +2
assert(
  'domain in snippet → +2',
  scoreConfidence(
    'https://www.facebook.com/unrelated',
    undefined,
    'Visit us at crosscycle.com for more information',
    undefined,
    'crosscycle.com',
  ),
  2,
);

// ── isHighConfidence integration — reported failing cases ─────────────────────

console.log('\nFailing cases from the bug report — must return FALSE');

// Bug: crosscycle.com was assigned facebook.com/crossschoolsbluffton
assert(
  'crosscycle.com must NOT accept facebook.com/crossschoolsbluffton',
  isHighConfidence(
    'https://www.facebook.com/crossschoolsbluffton',
    'Cross Schools Bluffton | Facebook',
    'Cross Schools Bluffton is a school in South Carolina.',
    'CrossCycle',
    'crosscycle.com',
  ),
  false,
);

// Bug: crosscycle.com was assigned linkedin.com/company/cross-company
assert(
  'crosscycle.com must NOT accept linkedin.com/company/cross-company',
  isHighConfidence(
    'https://www.linkedin.com/company/cross-company',
    'Cross Company | LinkedIn',
    'Cross Company is a wholesale supplier based in the US.',
    'CrossCycle',
    'crosscycle.com',
  ),
  false,
);

// Short generic company name "Cross" — must not match unrelated results
assert(
  '"Cross" company must NOT match "Cross Schools Bluffton" (short common word)',
  isHighConfidence(
    'https://www.facebook.com/crossschoolsbluffton',
    'Cross Schools Bluffton | Facebook',
    'A school in South Carolina.',
    'Cross',
    'crosscycle.com',
  ),
  false,
);

// ── isHighConfidence — must return TRUE (correct matches) ────────────────────
console.log('\nCorrect matches — must return TRUE');

// yotovstone.com → exact slug match alone is sufficient (score 2)
assert(
  'yotovstone.com accepts facebook.com/yotovstone (exact slug)',
  isHighConfidence(
    'https://www.facebook.com/yotovstone',
    'Yotov Stone | Facebook',
    undefined,
    'Yotov Stone',
    'yotovstone.com',
  ),
  true,
);

// yotovstone.com → slug + name in title
assert(
  'yotovstone.com accepts yotovstone (slug + name in title)',
  isHighConfidence(
    'https://www.linkedin.com/company/yotov-stone',
    'Yotov Stone | LinkedIn',
    undefined,
    'Yotov Stone',
    'yotovstone.com',
  ),
  true,
);

// starck.tech → slug prefix + name in title
assert(
  'starck.tech accepts linkedin.com/company/starck-technology (slug prefix + name)',
  isHighConfidence(
    'https://www.linkedin.com/company/starck-technology',
    'Starck Technology | LinkedIn',
    undefined,
    'Starck Technology',
    'starck.tech',
  ),
  true,
);

// Domain in snippet alone is sufficient (2 pts)
assert(
  'accepts when domain explicitly in snippet (2 pts)',
  isHighConfidence(
    'https://www.facebook.com/some-company',
    'Some Company | Facebook',
    'Official page of some-company.bg. Visit some-company.bg for details.',
    undefined,
    'some-company.bg',
  ),
  true,
);

// Two weak signals together: name in title (1) + long word match (1) = 2
assert(
  'walltopia.com: slug mismatch but name + long-word in title = 2 pts → accept',
  isHighConfidence(
    'https://www.facebook.com/walltopiaclimbing',
    'Walltopia | Facebook',
    undefined,
    'Walltopia',
    'walltopia.com',
  ),
  true,
);

// Company with hyphenated domain: "tashev-trans.bg" → domainBase "tashevetrans"
assert(
  'tashev-trans.bg: hyphen-normalised slug match',
  isHighConfidence(
    'https://www.facebook.com/tashev-trans',
    'Tashev Trans | Facebook',
    undefined,
    'Tashev Trans',
    'tashev-trans.bg',
  ),
  true,
);

// ── Edge cases ────────────────────────────────────────────────────────────────
console.log('\nEdge cases');

// Very short domain base (< 4 chars) — slug signal disabled, need other signals
assert(
  'domain base < 4 chars: slug signal disabled, name+snippet saves it',
  isHighConfidence(
    'https://www.facebook.com/bgsteel',
    'BG Steel | Facebook',
    'Visit bgsteel.bg for more info.',
    'BG Steel',
    'bgsteel.bg',
  ),
  true,
);

// Snippet missing, title partial match — single weak signal → reject
assert(
  'single weak signal (name in title only, short name) → reject',
  isHighConfidence(
    'https://www.facebook.com/atelier-paris',
    'Atelier Paris | Facebook',
    undefined,
    'Atelier',
    'atelier-bg.com',
  ),
  false,
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
