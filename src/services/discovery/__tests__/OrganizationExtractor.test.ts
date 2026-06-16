import { OrganizationExtractor } from '../OrganizationExtractor';
import type { PersonaSearchInput } from '../types';

const input: PersonaSearchInput = { persona: 'детски градини', location: 'гр. Мездра' };
const extractor = new OrganizationExtractor();

const MUNICIPALITY_TABLE_HTML = `
<html><body>
  <h1>Детски градини в Община Мездра</h1>
  <table>
    <tr>
      <th>Наименование</th>
      <th>Адрес</th>
      <th>Директор</th>
      <th>Телефон</th>
      <th>Имейл</th>
    </tr>
    <tr>
      <td>ДГ „Слънчице"</td>
      <td>ул. Хан Крум 5</td>
      <td>Мария Иванова</td>
      <td>0893 111 111</td>
      <td>dg-slanchice@mezdra.bg</td>
    </tr>
    <tr>
      <td>ДГ „Надежда"</td>
      <td>ул. Втора 12</td>
      <td>Петя Петрова</td>
      <td>0893 222 222</td>
      <td>dg-nadejda@mezdra.bg</td>
    </tr>
    <tr>
      <td>ЦДГ „Бъдеще"</td>
      <td>бул. Трети март 3</td>
      <td>Елена Стоянова</td>
      <td>0893 333 333</td>
      <td></td>
    </tr>
  </table>
</body></html>
`;

const MUNICIPALITY_LIST_HTML = `
<html><body>
  <h2>Детски градини</h2>
  <ul>
    <li>
      <strong>ДГ Пролет</strong>
      <p>ул. Осми март 8, тел. 0892 444 444, dg-prolet@example.bg</p>
    </li>
    <li>
      <strong>Детска Градина Зорница</strong>
      <p>кв. Север 15, тел. 0892 555 555</p>
    </li>
    <li>
      <strong>ДГ Слънце</strong>
      <p>пл. Независимост 1, dg-slance@example.bg</p>
      <a href="https://dg-slance-mezdra.bg">Официален сайт</a>
    </li>
  </ul>
</body></html>
`;

describe('OrganizationExtractor', () => {
  test('extracts kindergartens from municipality table', async () => {
    const results = await extractor.extractOrganizations(
      MUNICIPALITY_TABLE_HTML,
      'https://mezdra.bg/detski-gradini',
      input,
    );

    expect(results.length).toBeGreaterThanOrEqual(2);

    const names = results.map(r => r.name ?? '');
    expect(names.some(n => n.includes('Слънчице') || n.includes('Slanchice'))).toBe(true);
    expect(names.some(n => n.includes('Надежда'))).toBe(true);

    // Each result should be marked as extracted from the municipality page
    results.forEach(r => {
      expect(r.extractedFromUrl).toBe('https://mezdra.bg/detski-gradini');
      expect(r.sourceType).toBe('municipality');
      expect(r.pageType).toBe('TARGET_ORGANIZATION');
    });
  });

  test('extracts email and phone from municipality table rows', async () => {
    const results = await extractor.extractOrganizations(
      MUNICIPALITY_TABLE_HTML,
      'https://mezdra.bg/detski-gradini',
      input,
    );

    const withEmail = results.filter(r => r.email);
    expect(withEmail.length).toBeGreaterThanOrEqual(1);

    const withPhone = results.filter(r => r.phone);
    expect(withPhone.length).toBeGreaterThanOrEqual(1);
  });

  test('extracts organizations from list HTML', async () => {
    const results = await extractor.extractOrganizations(
      MUNICIPALITY_LIST_HTML,
      'https://example.bg/detski-gradini',
      input,
    );

    expect(results.length).toBeGreaterThanOrEqual(2);

    // The org with a link should have a website URL and domain
    const withWebsite = results.find(r => r.websiteUrl?.includes('dg-slance'));
    expect(withWebsite).toBeDefined();
    expect(withWebsite?.domain).toBe('dg-slance-mezdra.bg');
  });

  test('deduplicates org names within same page', async () => {
    // Add a duplicate of the first row
    const html = MUNICIPALITY_TABLE_HTML.replace(
      '</table>',
      `<tr>
        <td>ДГ „Слънчице"</td>
        <td>ул. Хан Крум 5</td>
        <td>Мария Иванова</td>
        <td>0893 111 111</td>
        <td>dg-slanchice@mezdra.bg</td>
      </tr></table>`,
    );

    const results = await extractor.extractOrganizations(html, 'https://mezdra.bg', input);
    const slanchiceCount = results.filter(r => r.name?.includes('Слънчице')).length;
    expect(slanchiceCount).toBe(1);
  });

  test('assigns confidence based on available signals', async () => {
    const results = await extractor.extractOrganizations(
      MUNICIPALITY_TABLE_HTML,
      'https://mezdra.bg/detski-gradini',
      input,
    );

    // All results should have positive confidence
    results.forEach(r => {
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.confidence).toBeLessThanOrEqual(100);
    });

    // Rows with email+phone should have higher confidence than those without
    const withEmailAndPhone = results.find(r => r.email && r.phone);
    const withoutEmail = results.find(r => !r.email && r.phone);
    if (withEmailAndPhone && withoutEmail) {
      expect(withEmailAndPhone.confidence).toBeGreaterThan(withoutEmail.confidence);
    }
  });
});
