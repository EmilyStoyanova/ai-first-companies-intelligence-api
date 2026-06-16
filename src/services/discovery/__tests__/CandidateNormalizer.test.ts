import { CandidateNormalizer } from '../CandidateNormalizer';
import type { DiscoverySourceResult } from '../types';

const normalizer = new CandidateNormalizer();

function makeCandidate(overrides: Partial<DiscoverySourceResult>): DiscoverySourceResult {
  return {
    sourceUrl:    overrides.domain ? `https://${overrides.domain}` : 'https://example.bg',
    sourceType:   'municipality',
    confidence:   50,
    pageType:     'TARGET_ORGANIZATION',
    ...overrides,
  };
}

describe('CandidateNormalizer', () => {
  test('deduplicates by domain — keeps higher confidence', () => {
    const candidates = [
      makeCandidate({ domain: 'dg-slance.bg', confidence: 60 }),
      makeCandidate({ domain: 'dg-slance.bg', confidence: 80 }),
    ];

    const result = normalizer.normalize(candidates);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(80);
  });

  test('deduplicates "ДГ Слънце" vs "Детска Градина Слънце" (same normalized name)', () => {
    const candidates = [
      makeCandidate({ name: 'ДГ Слънце', confidence: 60, phone: '0893111111' }),
      makeCandidate({ name: 'Детска Градина Слънце', confidence: 50, email: 'dg@example.bg' }),
    ];

    const result = normalizer.normalize(candidates);
    expect(result).toHaveLength(1);
    // Higher confidence wins
    expect(result[0].confidence).toBe(60);
    // Missing fields are filled from the duplicate
    expect(result[0].email).toBe('dg@example.bg');
    expect(result[0].phone).toBe('0893111111');
  });

  test('deduplicates "ЦДГ Слънце" vs "ДГ Слънце" (different prefixes, same name)', () => {
    const candidates = [
      makeCandidate({ name: 'ЦДГ Слънце', confidence: 55 }),
      makeCandidate({ name: 'дг слънце',  confidence: 45 }),
    ];

    const result = normalizer.normalize(candidates);
    expect(result).toHaveLength(1);
  });

  test('deduplicates by email', () => {
    const candidates = [
      makeCandidate({ domain: 'site-a.bg',   email: 'contact@dg.bg', confidence: 60 }),
      makeCandidate({ domain: 'site-b.bg',   email: 'contact@dg.bg', confidence: 40 }),
    ];

    const result = normalizer.normalize(candidates);
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe('site-a.bg');
  });

  test('deduplicates by normalized phone (different formats)', () => {
    const candidates = [
      makeCandidate({ phone: '0893 111 111', confidence: 70 }),
      makeCandidate({ phone: '+35989 311 1111', confidence: 40 }),
    ];

    // Same phone after normalization: 0893111111
    // NOTE: +35989 311 1111 has different digits, testing real normalization
    const candidates2 = [
      makeCandidate({ phone: '0893111111',   confidence: 70 }),
      makeCandidate({ phone: '+359893111111', confidence: 40 }),
    ];

    const result = normalizer.normalize(candidates2);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(70);
  });

  test('does NOT merge candidates with completely different data', () => {
    const candidates = [
      makeCandidate({ name: 'ДГ Слънце',    domain: 'dg-slance.bg',   email: 'a@a.bg', phone: '0893111111' }),
      makeCandidate({ name: 'ДГ Надежда',   domain: 'dg-nadejda.bg',  email: 'b@b.bg', phone: '0893222222' }),
      makeCandidate({ name: 'ЦДГ Бъдеще',   domain: 'cdg-badeshte.bg',email: 'c@c.bg', phone: '0893333333' }),
    ];

    const result = normalizer.normalize(candidates);
    expect(result).toHaveLength(3);
  });

  test('fills missing fields from lower-confidence duplicate', () => {
    const candidates = [
      makeCandidate({ name: 'ДГ Слънце', confidence: 80, domain: 'dg-slance.bg', email: undefined }),
      makeCandidate({ name: 'ДГ Слънце', confidence: 50, email: 'info@dg-slance.bg' }),
    ];

    const result = normalizer.normalize(candidates);
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('info@dg-slance.bg');
  });
});
