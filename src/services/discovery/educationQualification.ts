import type { DiscoverySourceResult } from './types';

// ── Persona detection ─────────────────────────────────────────────────────────

const EDUCATION_PERSONA_KEYWORDS = [
  'училище', 'училища',
  'гимназия', 'гимназии',
  'детска градина', 'детски градини',
  'kindergarten',
  'school', 'schools',
  'оу', 'су', 'пг', 'дг', 'цдг',
  'образование', 'education',
];

export function isEducationPersona(persona: string): boolean {
  const lower = persona.toLowerCase();
  return EDUCATION_PERSONA_KEYWORDS.some(k => lower.includes(k));
}

// ── School name prefix detection ──────────────────────────────────────────────
// Matches "ОУ ", "СУ ", "ПГ ", etc. at the start of a name (case-insensitive)

const SCHOOL_PREFIX_RE = new RegExp(
  '^(?:оу|су|пг|пмг|ппмг|нпг|пгт|пгхт|пгмет|пгсс|пге|пгасг|пги|пгтм|птг|дг|цдг|дс|дя|ну|пу|ог|суе|сое|профилирана гимназия|природо|математическа)\\s',
  'i',
);

// ── Educational keywords anywhere in name ─────────────────────────────────────
// Note: \b is intentionally omitted for Cyrillic terms — JS regex \b only works
// with ASCII word characters (\w = [a-zA-Z0-9_]), so Cyrillic chars are treated
// as \W and word-boundary assertions never fire around them.

const EDUCATION_KEYWORD_RE =
  /училище|гимназия|school|kindergarten|детска\s+градина|детски\s+ясли|университет|академия|колеж|школа|институт|institute|образовател/i;

// ── Hard-reject patterns (checked before scoring) ─────────────────────────────
// \b is kept only for pure-ASCII patterns where it works reliably.

const NEGATIVE_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /община|municipality|кметство/i,                       reason: 'municipality' },
  { re: /регистър|registar|\bregist(?:er|ry)\b/i,              reason: 'registry'     },
  { re: /\bdirectory\b|каталог|catalog|справочник|директория/i, reason: 'directory'    },
  { re: /рейтинг|\branking\b|класация/i,                       reason: 'ranking'      },
  { re: /\bguide\b|наръчник/i,                                 reason: 'guide'        },
  { re: /портал|\bportal\b/i,                                  reason: 'portal'       },
  { re: /новини|\bnews\b|форум|\bforum\b/i,                    reason: 'news'         },
];

// ── Domain-level negative check (for non-extracted direct candidates only) ────

const NEGATIVE_DOMAIN_RE =
  /(?:guide|directory|catalog|portal|register|registar|spravochnik)/i;

// ── Result type ───────────────────────────────────────────────────────────────

export interface EducationQualificationResult {
  accepted: boolean;
  confidence: number;
  reason?: string;
}

/**
 * Classifies a single discovery candidate for education persona searches.
 *
 * Scoring model:
 *   Baseline:            30
 *   +40  school prefix present (ОУ, СУ, ПГ, ДГ, ...)
 *   +20  educational keyword present
 *   +10  has own dedicated website domain
 *   +10  has pre-crawl contact info (email or phone)
 *   Accept threshold: >= 60
 *
 *   Hard-reject: name matches municipality / registry / directory / ranking /
 *                guide / portal / news patterns (score is irrelevant).
 *   Hard-reject: domain matches directory patterns (non-extracted candidates only).
 *
 * Special case (requirement 8): if the candidate has a social platform domain,
 * it is already rejected upstream by CandidateQualifier; this function is not
 * reached for social-domain candidates.
 */
export function classifyEducationCandidate(
  candidate: DiscoverySourceResult,
): EducationQualificationResult {
  const name = (candidate.name ?? candidate.title ?? '').trim();
  const domain = candidate.domain ?? '';

  // ── Step 1: hard-reject by name ────────────────────────────────────────────
  for (const { re, reason } of NEGATIVE_PATTERNS) {
    if (re.test(name)) {
      console.log(`[education] rejected name="${name}" reason=${reason}`);
      return { accepted: false, confidence: 0, reason };
    }
  }

  // ── Step 2: hard-reject by domain (direct candidates only) ────────────────
  // "unless the extracted organization has its own website domain"
  if (!candidate.extractedFromUrl && domain && NEGATIVE_DOMAIN_RE.test(domain)) {
    console.log(`[education] rejected name="${name}" domain="${domain}" reason=directory_domain`);
    return { accepted: false, confidence: 0, reason: 'directory_domain' };
  }

  // ── Step 3: positive confidence scoring ───────────────────────────────────
  let confidence = 30;

  if (SCHOOL_PREFIX_RE.test(name))     confidence += 40; // strong: ОУ, СУ, ПГ…
  if (EDUCATION_KEYWORD_RE.test(name)) confidence += 20; // keyword: училище, гимназия…
  if (domain && !domain.endsWith('.local')) confidence += 10; // has own website
  if (candidate.email || candidate.phone)  confidence += 10; // has contact

  if (confidence >= 60) {
    console.log(`[education] accepted school name="${name}" confidence=${confidence}`);
    return { accepted: true, confidence };
  }

  console.log(
    `[education] rejected name="${name}" reason=insufficient_education_confidence` +
    ` confidence=${confidence}`,
  );
  return { accepted: false, confidence, reason: 'insufficient_education_confidence' };
}
