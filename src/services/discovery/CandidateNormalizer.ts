import type { DiscoverySourceResult } from './types';

// Common Bulgarian organization type prefixes stripped when comparing names
const STRIP_PREFIXES = [
  'детска градина ', 'детски ясли ', 'детско заведение ',
  'целодневна детска градина ', 'обединено детско заведение ',
  'дг ', 'цдг ', 'дс ', 'дя ', 'одз ', 'ддуи ', 'дцср ', 'цсри ',
  // School prefixes
  'начално училище ', 'основно училище ', 'средно училище ',
  'средно общообразователно училище ', 'профилирана гимназия ',
  'природо-математическа гимназия ', 'гимназия ', 'колеж ',
  'ну ', 'оу ', 'су ', 'суе ', 'пмг ', 'пг ', 'пу ', 'ог ',
  // Healthcare
  'многопрофилна болница за активно лечение ', 'болница ', 'мбал ',
  'диагностично-консултативен център ', 'дкц ',
  // Other
  'читалище ', 'народно читалище ', 'нчх ',
  'хотел ', 'ресторант ',
];

// Strip quotes, special chars, extra spaces from comparison key
function sanitize(s: string): string {
  return s
    .replace(/[«»„"''\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeOrgName(raw: string): string {
  let n = raw.toLowerCase().trim();
  n = sanitize(n);
  for (const prefix of STRIP_PREFIXES) {
    if (n.startsWith(prefix)) {
      n = n.slice(prefix.length).trim();
      break;
    }
  }
  return n;
}

function normalizePhone(phone: string): string {
  return phone
    .replace(/[\s\-\(\)\.\+]/g, '')
    .replace(/^00359/, '0')
    .replace(/^359/, '0');
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Deduplicates a list of DiscoverySourceResult candidates.
 *
 * Grouping keys (any match → merge):
 *  1. Same domain
 *  2. Same normalized email
 *  3. Same normalized phone
 *  4. Same normalized org name (strips type prefixes: ДГ, ЦДГ, etc.)
 *
 * When merging, the candidate with the highest confidence is kept, enriched
 * with any contact fields the lower-confidence duplicate had.
 */
export class CandidateNormalizer {
  normalize(candidates: DiscoverySourceResult[]): DiscoverySourceResult[] {
    // Build union-find groups
    const n = candidates.length;
    const parent = Array.from({ length: n }, (_, i) => i);

    const find = (i: number): number => {
      if (parent[i] !== i) parent[i] = find(parent[i]);
      return parent[i];
    };
    const union = (a: number, b: number) => {
      parent[find(a)] = find(b);
    };

    // Build lookup indices
    const byDomain = new Map<string, number>();
    const byEmail = new Map<string, number>();
    const byPhone = new Map<string, number>();
    const byName = new Map<string, number>();

    for (let i = 0; i < n; i++) {
      const c = candidates[i];

      if (c.domain) {
        const k = c.domain.toLowerCase();
        if (byDomain.has(k)) union(i, byDomain.get(k)!);
        else byDomain.set(k, i);
      }

      if (c.email) {
        const k = normalizeEmail(c.email);
        if (byEmail.has(k)) union(i, byEmail.get(k)!);
        else byEmail.set(k, i);
      }

      if (c.phone) {
        const k = normalizePhone(c.phone);
        if (byPhone.has(k)) union(i, byPhone.get(k)!);
        else byPhone.set(k, i);
      }

      const nameKey = c.name ? normalizeOrgName(c.name) : null;
      if (nameKey && nameKey.length > 2) {
        if (byName.has(nameKey)) union(i, byName.get(nameKey)!);
        else byName.set(nameKey, i);
      }
    }

    // Group by root
    const groups = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(i);
    }

    // Merge each group: keep the highest-confidence candidate, fill missing fields
    const merged: DiscoverySourceResult[] = [];
    for (const group of groups.values()) {
      const sorted = group
        .map(i => candidates[i])
        .sort((a, b) => b.confidence - a.confidence);

      const primary = { ...sorted[0] };
      for (const dup of sorted.slice(1)) {
        // Fill missing fields from lower-confidence duplicates
        if (!primary.email && dup.email)     primary.email = dup.email;
        if (!primary.phone && dup.phone)     primary.phone = dup.phone;
        if (!primary.address && dup.address) primary.address = dup.address;
        if (!primary.domain && dup.domain)   primary.domain = dup.domain;
        if (!primary.websiteUrl && dup.websiteUrl) primary.websiteUrl = dup.websiteUrl;
        if (!primary.name && dup.name)       primary.name = dup.name;
      }
      merged.push(primary);
    }

    return merged;
  }
}
