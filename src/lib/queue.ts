import PgBoss from 'pg-boss';

export const QUEUES = {
  CRAWL_COMPANY: 'crawl-company',
  DISCOVER_PERSONA: 'discover-persona',
} as const;

export interface CrawlCompanyPayload {
  companyId: string;
  domain: string;
  baseUrl: string;
  batchId: string;
  tenantId: string;
}

export interface DiscoverPersonaPayload {
  batchId: string;
  tenantId: string;
  persona: string;
  location: string;
  keywords?: string;
  maxResults?: number;
}

let boss: PgBoss | null = null;

export async function getQueue(): Promise<PgBoss> {
  if (boss) return boss;

  boss = new PgBoss({
    connectionString: process.env.DATABASE_URL!,
    retentionDays: 7,
  });

  boss.on('error', (err) => {
    console.error('[pg-boss] error:', err);
  });

  await boss.start();

  // pg-boss v10 requires queues to be created before sending
  await boss.createQueue(QUEUES.CRAWL_COMPANY);
  await boss.createQueue(QUEUES.DISCOVER_PERSONA);

  console.log('[pg-boss] started');
  return boss;
}

export async function enqueueCrawlJob(
  payload: CrawlCompanyPayload,
  queue: PgBoss
): Promise<void> {
  await queue.send(QUEUES.CRAWL_COMPANY, payload as unknown as object, {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
  });
}

export async function enqueueDiscoverJob(
  payload: DiscoverPersonaPayload,
  queue: PgBoss
): Promise<void> {
  await queue.send(QUEUES.DISCOVER_PERSONA, payload as unknown as object, {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: false,
  });
}

export async function stopQueue(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
  }
}
