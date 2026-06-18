import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const bad = await prisma.$queryRaw<Array<{
    id: string;
    domain: string;
    name: string | null;
    crawlStatus: string;
    createdAt: Date;
  }>>`
    SELECT id, domain, name, "crawlStatus", "createdAt"
    FROM "Company"
    WHERE
      domain ~ '[\\u0400-\\u04FF]'
      OR domain !~ '\\.[a-z]{2,}$'
    ORDER BY "createdAt" DESC
  `;

  console.log(`\nНамерени фирми с невалиден домейн: ${bad.length}\n`);
  console.table(bad.map(r => ({
    id:          r.id,
    domain:      r.domain,
    name:        r.name ?? '(няма)',
    status:      r.crawlStatus,
    createdAt:   r.createdAt.toISOString().slice(0, 10),
  })));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
