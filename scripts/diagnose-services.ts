/**
 * Diagnostic script: why are services empty for specific companies?
 *
 * Run with:
 *   npx ts-node scripts/diagnose-services.ts
 *
 * Shows for each domain:
 *  - crawlStatus, crawlNote
 *  - profile.services (what's in DB)
 *  - profile.primaryIndustry / representedBrands (did AI run at confidence >= 50?)
 *  - crawled page URLs + html lengths (did selectServicesPage have anything to work with?)
 *  - which page selectServicesPage would pick
 *  - re-runs validateServices live against stored HTML and shows confidence + raw result
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { selectServicesPage } from '../src/services/servicesValidation';
import { validateServices } from '../src/services/servicesValidation';
import type { CrawledPage } from '../src/worker/crawl';

const DOMAINS = [
  'chehplast.com',
  'hubev.bg',
  'parshevitsa.com',
  'inex-bg.com',
  'crosscycle.com',
  'vratsa-stone.com',
  'tashev-trans.com',
  'yotovstone.com',
  'lvmasters.com',
  'tdm-plast.com',
];

async function main() {
  for (const domain of DOMAINS) {
    console.log('\n' + '═'.repeat(70));
    console.log(`DOMAIN: ${domain}`);
    console.log('═'.repeat(70));

    const company = await prisma.company.findUnique({
      where: { domain },
      include: {
        profile: true,
        rawProfiles: { select: { specificUrl: true, data: true } },
      },
    });

    if (!company) {
      console.log('  ✗ Not found in DB');
      continue;
    }

    // ── 1. Company status ────────────────────────────────────────────────────
    console.log(`  crawlStatus   : ${company.crawlStatus}`);
    console.log(`  crawlNote     : ${company.crawlNote ?? '—'}`);

    if (!company.profile) {
      console.log('  ✗ No CompanyProfile row');
      continue;
    }

    const p = company.profile;
    const services        = Array.isArray(p.services)        ? p.services as string[]        : [];
    const representedBrands = Array.isArray(p.representedBrands) ? p.representedBrands as string[] : [];

    // ── 2. What's stored ────────────────────────────────────────────────────
    console.log(`  services (DB) : ${services.length > 0 ? services.join(', ') : '[] ← EMPTY'}`);
    console.log(`  primaryIndustry: ${p.primaryIndustry ?? '(null — AI either skipped or confidence < 50)'}`);
    console.log(`  representedBrands: ${representedBrands.length > 0 ? representedBrands.join(', ') : '[]'}`);

    // ── 3. Crawled pages ────────────────────────────────────────────────────
    console.log(`  rawProfiles   : ${company.rawProfiles.length} pages crawled`);
    const pages: CrawledPage[] = company.rawProfiles.map((r) => {
      const d = r.data as Record<string, unknown>;
      return {
        url:            r.specificUrl,
        text:           typeof d.text  === 'string' ? d.text  : '',
        html:           '',   // not stored in rawProfiles
        emails:         Array.isArray(d.emails) ? d.emails as string[] : [],
        phones:         Array.isArray(d.phones) ? d.phones as string[] : [],
        loginProtected: false,
        logoUrls:       [],
      };
    });
    for (const pg of pages) {
      console.log(`    ${pg.url}`);
    }

    // ── 4. selectServicesPage ────────────────────────────────────────────────
    // rawProfiles don't store HTML, so we can only check URL selection
    const urlOnlyPages = pages.map((pg) => ({ ...pg, html: 'x'.repeat(200) }));
    const selected = selectServicesPage(urlOnlyPages);
    console.log(`  selectServicesPage → ${selected?.url ?? '(none)'}`);

    const hasServicesUrl = pages.some((pg) =>
      /uslug|produk|deynost|deinost|services|products|about|za-nas|about-us/i.test(pg.url),
    );
    console.log(`  services URL matched: ${hasServicesUrl ? 'YES' : 'NO — fell back to largest HTML'}`);

    // ── 5. Live re-run of validateServices (needs GROQ_API_KEY) ────────────
    // We can only do this if HTML is available; rawProfiles stores text not html.
    if (process.env.GROQ_API_KEY) {
      // Use the page text as a proxy (won't be perfect but shows confidence signal)
      const bestPage = pages.reduce<CrawledPage | undefined>((best, cur) =>
        (!best || cur.text.length > best.text.length) ? cur : best,
      undefined);

      if (bestPage && bestPage.text.length > 100) {
        console.log(`  re-running validateServices on text of ${bestPage.url} (${bestPage.text.length} chars)...`);
        try {
          const result = await validateServices(
            p.name ?? domain,
            domain,
            bestPage.url,
            bestPage.text,  // text proxy — not ideal but shows LLM response
          );
          console.log(`  → confidence   : ${result.confidence}`);
          console.log(`  → services     : ${result.services.length > 0 ? result.services.join(', ') : '[]'}`);
          console.log(`  → primaryIndustry: ${result.primary_industry ?? '(none)'}`);
          console.log(`  → no_services_found: ${result.no_services_found}`);
          if (result.notes) console.log(`  → notes        : ${result.notes}`);
          if (result.confidence < 50) {
            console.log(`  ⚠ confidence ${result.confidence} < 50 — parseResponse discards everything`);
          }
        } catch (e) {
          console.log(`  ✗ validateServices threw: ${e}`);
        }
      } else {
        console.log('  ⚠ No text available to re-run validateServices');
      }
    } else {
      console.log('  ⚠ GROQ_API_KEY not set — skipping live re-run');
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
