import { buildDiscoveryKey } from '../discoveryKey';

describe('buildDiscoveryKey', () => {
  // ── Basic shape ─────────────────────────────────────────────────────────────

  test('produces pipe-separated key', () => {
    expect(buildDiscoveryKey('детски градини', 'Враца', '')).toBe('детски градини|враца|');
  });

  test('empty keywords produces trailing empty segment', () => {
    expect(buildDiscoveryKey('детски градини', 'Враца')).toBe('детски градини|враца|');
  });

  // ── Case insensitivity ───────────────────────────────────────────────────────

  test('persona is lowercased', () => {
    expect(buildDiscoveryKey('ДЕТСКИ ГРАДИНИ', 'Враца'))
      .toBe(buildDiscoveryKey('детски градини', 'Враца'));
  });

  test('location is lowercased', () => {
    expect(buildDiscoveryKey('детски градини', 'ВРАЦА'))
      .toBe(buildDiscoveryKey('детски градини', 'враца'));
  });

  // ── Whitespace normalization ─────────────────────────────────────────────────

  test('leading/trailing spaces are stripped', () => {
    expect(buildDiscoveryKey('  детски градини  ', '  Враца  '))
      .toBe('детски градини|враца|');
  });

  test('multiple internal spaces are collapsed', () => {
    expect(buildDiscoveryKey('детски  градини', 'Враца'))
      .toBe('детски градини|враца|');
  });

  // ── Keyword normalization ────────────────────────────────────────────────────

  test('keywords are sorted alphabetically', () => {
    expect(buildDiscoveryKey('детски градини', 'Враца', 'частни английски'))
      .toBe(buildDiscoveryKey('детски градини', 'Враца', 'английски частни'));
  });

  test('undefined keywords equals empty string keywords', () => {
    expect(buildDiscoveryKey('детски градини', 'Враца', undefined))
      .toBe(buildDiscoveryKey('детски градини', 'Враца', ''));
  });

  test('keywords are lowercased', () => {
    expect(buildDiscoveryKey('детски градини', 'Враца', 'ЧАСТНИ'))
      .toBe(buildDiscoveryKey('детски градини', 'Враца', 'частни'));
  });

  // ── City prefix stripping ────────────────────────────────────────────────────

  test('"гр. Враца" matches "Враца"', () => {
    expect(buildDiscoveryKey('детски градини', 'гр. Враца'))
      .toBe(buildDiscoveryKey('детски градини', 'Враца'));
  });

  test('"гр Враца" (no dot) matches "Враца"', () => {
    expect(buildDiscoveryKey('детски градини', 'гр Враца'))
      .toBe(buildDiscoveryKey('детски градини', 'Враца'));
  });

  test('"град Враца" matches "Враца"', () => {
    expect(buildDiscoveryKey('детски градини', 'град Враца'))
      .toBe(buildDiscoveryKey('детски градини', 'Враца'));
  });

  // ── Oblast is preserved (different from city) ────────────────────────────────

  test('"област Враца" produces different key from "Враца"', () => {
    expect(buildDiscoveryKey('детски градини', 'област Враца'))
      .not.toBe(buildDiscoveryKey('детски градини', 'Враца'));
  });

  // ── Distinctness ─────────────────────────────────────────────────────────────

  test('different location produces different key', () => {
    expect(buildDiscoveryKey('детски градини', 'Враца'))
      .not.toBe(buildDiscoveryKey('детски градини', 'Ловеч'));
  });

  test('different persona produces different key', () => {
    expect(buildDiscoveryKey('детски градини', 'Враца'))
      .not.toBe(buildDiscoveryKey('училища', 'Враца'));
  });

  test('different keywords produce different key', () => {
    expect(buildDiscoveryKey('детски градини', 'Враца', 'частни'))
      .not.toBe(buildDiscoveryKey('детски градини', 'Враца', 'общински'));
  });
});
