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

  test('rejects SOCIAL_PAGE (pageType-level rejection for non-listed social networks)', () => {
    // vk.com is a social network not in the isSocialPlatform hardcoded list;
    // rejection falls through to the pageType check instead.
    const c = makeCandidate({ pageType: 'SOCIAL_PAGE', domain: 'vk.com' });
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

  // ── Social platform tests ──────────────────────────────────────────────────

  test('A — rejects facebook.com/company as company domain', () => {
    const c = makeCandidate({ domain: 'facebook.com', websiteUrl: 'https://facebook.com/company', pageType: 'TARGET_ORGANIZATION' });
    const { accepted, reason } = qualifier.qualify(c, input);
    expect(accepted).toBe(false);
    expect(reason).toBe('social_platform_domain');
  });

  test('B — rejects linkedin.com/company/openai as company domain', () => {
    const c = makeCandidate({ domain: 'linkedin.com', websiteUrl: 'https://linkedin.com/company/openai', pageType: 'TARGET_ORGANIZATION' });
    const { accepted, reason } = qualifier.qualify(c, input);
    expect(accepted).toBe(false);
    expect(reason).toBe('social_platform_domain');
  });

  test('C — rejects instagram.com/company as company domain', () => {
    const c = makeCandidate({ domain: 'instagram.com', websiteUrl: 'https://instagram.com/company', pageType: 'TARGET_ORGANIZATION' });
    const { accepted, reason } = qualifier.qualify(c, input);
    expect(accepted).toBe(false);
    expect(reason).toBe('social_platform_domain');
  });

  test('D — accepts company.com as valid company domain', () => {
    const c = makeCandidate({ domain: 'company.com', websiteUrl: 'https://company.com', pageType: 'TARGET_ORGANIZATION' });
    expect(qualifier.isAccepted(c, input)).toBe(true);
  });

  test('E — org with real website keeps company.com; facebook is not used as primary domain', () => {
    // When an org has a real websiteUrl and a separate social link,
    // only the real website would be set as domain — facebook is never domain here
    const c = makeCandidate({
      domain:     'company.com',
      websiteUrl: 'https://company.com',
      pageType:   'TARGET_ORGANIZATION',
      confidence: 70,
    });
    const { accepted } = qualifier.qualify(c, input);
    expect(accepted).toBe(true);
    expect(c.domain).toBe('company.com');
  });

  test('F — rejects facebook.com even when extracted from a list page (bypasses isExtracted check)', () => {
    const c = makeCandidate({
      domain:          'facebook.com',
      websiteUrl:      'https://facebook.com/su-ivan-vazov',
      pageType:        'TARGET_ORGANIZATION',
      confidence:      70,
      extractedFromUrl: 'https://mezdra.bg/uchilishta',
    });
    const { accepted, reason } = qualifier.qualify(c, input);
    expect(accepted).toBe(false);
    expect(reason).toBe('social_platform_domain');
  });
});
