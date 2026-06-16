import { CandidateQualifier } from '../CandidateQualifier';
import type { DiscoverySourceResult, PersonaSearchInput } from '../types';

const qualifier = new CandidateQualifier();
const input: PersonaSearchInput = { persona: 'детски градини', location: 'гр. Мездра' };

function makeCandidate(overrides: Partial<DiscoverySourceResult>): DiscoverySourceResult {
  return {
    sourceUrl:   'https://example.bg',
    sourceType:  'municipality',
    confidence:  70,
    pageType:    'TARGET_ORGANIZATION',
    domain:      'example.bg',
    ...overrides,
  };
}

describe('CandidateQualifier', () => {
  test('accepts a TARGET_ORGANIZATION with domain and good confidence', () => {
    const c = makeCandidate({ pageType: 'TARGET_ORGANIZATION', domain: 'dg-slance.bg', confidence: 75 });
    expect(qualifier.isAccepted(c, input)).toBe(true);
  });

  test('accepts an extracted org with phone (no domain) if confidence is sufficient', () => {
    const c = makeCandidate({
      pageType: 'TARGET_ORGANIZATION',
      domain:   undefined,
      phone:    '0893111111',
      confidence: 55,
      extractedFromUrl: 'https://mezdra.bg/detski-gradini',
    });
    expect(qualifier.isAccepted(c, input)).toBe(true);
  });

  test('rejects a MUNICIPALITY_PAGE that is NOT extracted from a list', () => {
    const c = makeCandidate({ pageType: 'MUNICIPALITY_PAGE', domain: 'mezdra.bg' });
    const { accepted, reason } = qualifier.qualify(c, input);
    expect(accepted).toBe(false);
    expect(reason).toBe('municipality_page');
  });

  test('accepts an org EXTRACTED from a municipality page', () => {
    const c = makeCandidate({
      pageType:        'TARGET_ORGANIZATION',
      domain:          'dg-slance.bg',
      confidence:      65,
      extractedFromUrl: 'https://mezdra.bg/detski-gradini',
    });
    expect(qualifier.isAccepted(c, input)).toBe(true);
  });

  test('rejects NEWS_ARTICLE', () => {
    const c = makeCandidate({ pageType: 'NEWS_ARTICLE', domain: 'news.bg' });
    const { accepted, reason } = qualifier.qualify(c, input);
    expect(accepted).toBe(false);
    expect(reason).toBe('news_article');
  });

  test('rejects DIRECTORY_OR_PORTAL', () => {
    const c = makeCandidate({ pageType: 'DIRECTORY_OR_PORTAL', domain: 'katalog.bg' });
    const { accepted, reason } = qualifier.qualify(c, input);
    expect(accepted).toBe(false);
    expect(reason).toBe('directory_or_portal');
  });

  test('rejects SOCIAL_PAGE', () => {
    const c = makeCandidate({ pageType: 'SOCIAL_PAGE', domain: 'facebook.com' });
    const { accepted, reason } = qualifier.qualify(c, input);
    expect(accepted).toBe(false);
    expect(reason).toBe('social_page');
  });

  test('rejects IRRELEVANT', () => {
    const c = makeCandidate({ pageType: 'IRRELEVANT', domain: 'unrelated.bg' });
    const { accepted, reason } = qualifier.qualify(c, input);
    expect(accepted).toBe(false);
    expect(reason).toBe('irrelevant');
  });

  test('rejects low confidence candidate', () => {
    const c = makeCandidate({ pageType: 'TARGET_ORGANIZATION', domain: 'dg.bg', confidence: 20 });
    const { accepted, reason } = qualifier.qualify(c, input);
    expect(accepted).toBe(false);
    expect(reason).toMatch(/low_confidence/);
  });

  test('rejects candidate with no contact signal and synthetic domain', () => {
    const c = makeCandidate({
      pageType:  'TARGET_ORGANIZATION',
      domain:    'extracted-abc123.local',
      confidence: 60,
      email:     undefined,
      phone:     undefined,
    });
    const { accepted, reason } = qualifier.qualify(c, input);
    expect(accepted).toBe(false);
    expect(reason).toBe('no_contact_signal');
  });

  test('accepts synthetic domain candidate if it has email', () => {
    const c = makeCandidate({
      pageType:   'TARGET_ORGANIZATION',
      domain:     'extracted-abc123.local',
      confidence: 60,
      email:      'dg@example.bg',
    });
    expect(qualifier.isAccepted(c, input)).toBe(true);
  });

  test('rejects extracted org whose domain is the same as the source page', () => {
    // e.g. "Регистър на детските градини" extracted FROM registarnadetskitegradini.com
    // but pointing back to the same registarnadetskitegradini.com domain
    const c = makeCandidate({
      pageType:        'TARGET_ORGANIZATION',
      domain:          'registarnadetskitegradini.com',
      confidence:      55,
      extractedFromUrl: 'https://registarnadetskitegradini.com/mezdra',
    });
    const { accepted, reason } = qualifier.qualify(c, input);
    expect(accepted).toBe(false);
    expect(reason).toBe('same_domain_as_source');
  });

  test('accepts extracted org with different domain than source page', () => {
    const c = makeCandidate({
      pageType:        'TARGET_ORGANIZATION',
      domain:          'dg-slance.bg',
      confidence:      65,
      extractedFromUrl: 'https://mezdra.bg/detski-gradini',
    });
    expect(qualifier.isAccepted(c, input)).toBe(true);
  });
});
