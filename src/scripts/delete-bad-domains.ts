import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BAD_DOMAINS = [
  'инекс трейд',
  'хубев',
  'крос',
  'серпио',
  'пършевица-зоров',
  'старк тек',
  'ташев транс',
  'лалов и вачев',
  'техкерамик-м оод',
  'председник еоод',
  'чех пласт оод',
  'yotov stone',
  'tdm plast',
];

async function main() {
  const dryRun = !process.argv.includes('--apply');

  const companies = await prisma.company.findMany({
    where: { domain: { in: BAD_DOMAINS } },
    select: { id: true, domain: true, name: true, crawlStatus: true },
  });

  console.log(`\nНамерени: ${companies.length} фирми за изтриване\n`);
  console.table(companies.map(c => ({ domain: c.domain, name: c.name ?? '(няма)', status: c.crawlStatus })));

  if (companies.length === 0) {
    console.log('Нищо за изтриване.');
    return;
  }

  if (dryRun) {
    console.log('\n[DRY RUN] Подай --apply за реално изтриване.\n');
    return;
  }

  const ids = companies.map(c => c.id);

  await prisma.$transaction(async (tx) => {
    const pc = await tx.personalizedContent.deleteMany({ where: { companyId: { in: ids } } });
    console.log(`Изтрити PersonalizedContent: ${pc.count}`);

    const cp = await tx.companyProfile.deleteMany({ where: { companyId: { in: ids } } });
    console.log(`Изтрити CompanyProfile: ${cp.count}`);

    const rp = await tx.rawCompanyProfile.deleteMany({ where: { companyId: { in: ids } } });
    console.log(`Изтрити RawCompanyProfile: ${rp.count}`);

    const tc = await tx.tenantCompany.deleteMany({ where: { companyId: { in: ids } } });
    console.log(`Изтрити TenantCompany: ${tc.count}`);

    const co = await tx.company.deleteMany({ where: { id: { in: ids } } });
    console.log(`Изтрити Company: ${co.count}`);
  });

  console.log('\nГотово. Всички 13 фирми с грешни домейни са изтрити.\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
