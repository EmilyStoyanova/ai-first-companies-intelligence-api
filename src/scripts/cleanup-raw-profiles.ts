/**
 * RawCompanyProfile Cleanup & Backfill Script
 *
 * Usage:
 *   npm run cleanup:raw-profiles -- --dry-run   (inspect, no writes)
 *   npm run cleanup:raw-profiles -- --apply      (commit changes)
 *
 * What it does:
 *   1. Backfills normalizedUrl for every record that still holds the raw specificUrl
 *      (set by migration 1 as a placeholder).
 *   2. Groups records by (companyId, normalizedUrl).
 *   3. For each duplicate group picks one survivor, merges content, deletes the rest.
 *
 * Safe to re-run: a second run will find no duplicate groups and exit immediately.
 *
 * Run BEFORE applying migration 2 (the unique-index migration).
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { normalizeRawProfileUrl } from '../lib/normalizeRawProfileUrl';

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--apply');
const PREFIX = '[raw-profile-cleanup]';
const FRESHNESS_DAYS = 7;
const FRESHNESS_MS = FRESHNESS_DAYS * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawRow {
  id: string;
  companyId: string;
  baseUrl: string;
  specificUrl: string;
  normalizedUrl: string;
  data: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

interface DataShape {
  text?: string;
  emails?: string[];
  phones?: string[];
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function asData(value: Prisma.JsonValue): DataShape {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const v = value as Record<string, Prisma.JsonValue>;
  return {
    text:   typeof v.text   === 'string'   ? v.text   : undefined,
    emails: Array.isArray(v.emails)        ? v.emails as string[] : [],
    phones: Array.isArray(v.phones)        ? v.phones as string[] : [],
  };
}

/** Higher score = richer, preferred as survivor. */
function scoreRow(row: RawRow): number {
  const d = asData(row.data);
  return (d.text?.length ?? 0)
       + (d.emails?.length ?? 0) * 100
       + (d.phones?.length ?? 0) * 50;
}

/**
 * Merge an array of data records: union all emails/phones, keep the longest text.
 * Newest records (by updatedAt) win on equal text length.
 */
function mergeData(rows: RawRow[]): DataShape {
  const sorted = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const emails = [...new Set(sorted.flatMap(r => asData(r.data).emails ?? []))];
  const phones = [...new Set(sorted.flatMap(r => asData(r.data).phones ?? []))];
  const text = sorted.reduce<string>((best, r) => {
    const t = asData(r.data).text ?? '';
    return t.length > best.length ? t : best;
  }, '');
  return { text, emails, phones };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (DRY_RUN) {
    console.log(`${PREFIX} DRY RUN — no writes. Pass --apply to commit.`);
  } else {
    console.log(`${PREFIX} APPLY mode — writing to database.`);
  }

  // ── Step 1: Load all records ───────────────────────────────────────────────
  const all = await prisma.rawCompanyProfile.findMany({
    orderBy: { createdAt: 'asc' },
  }) as unknown as RawRow[];

  console.log(`${PREFIX} total records loaded=${all.length}`);
  if (all.length === 0) {
    console.log(`${PREFIX} nothing to do — table is empty`);
    return;
  }

  // ── Step 2: Re-normalise URLs that still hold the raw specificUrl placeholder ─
  // Migration 1 seeded normalizedUrl = specificUrl.  We replace those with the
  // canonical form (lowercase, no www, no trailing slash, no tracking params).
  const needsNorm = all.filter(r => r.normalizedUrl === r.specificUrl);
  const alreadyNorm = all.length - needsNorm.length;
  console.log(`${PREFIX} already properly normalised=${alreadyNorm} needs re-normalisation=${needsNorm.length}`);

  for (const row of all) {
    const proper = normalizeRawProfileUrl(row.specificUrl);
    if (row.normalizedUrl !== proper) {
      if (!DRY_RUN) {
        // Use raw SQL to avoid unique-constraint issues before dedup runs.
        await prisma.$executeRaw`
          UPDATE "RawCompanyProfile"
          SET "normalizedUrl" = ${proper}
          WHERE id = ${row.id}
        `;
      }
      row.normalizedUrl = proper; // keep in-memory view in sync
    }
  }

  if (!DRY_RUN && needsNorm.length > 0) {
    console.log(`${PREFIX} normalised ${needsNorm.length} URL(s)`);
  } else if (DRY_RUN && needsNorm.length > 0) {
    console.log(`${PREFIX} [dry-run] would normalise ${needsNorm.length} URL(s)`);
  }

  // ── Step 3: Group by (companyId, normalizedUrl) ────────────────────────────
  const groups = new Map<string, RawRow[]>();
  for (const row of all) {
    const key = `${row.companyId}::${row.normalizedUrl}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const dupGroups = [...groups.values()].filter(g => g.length > 1);
  console.log(`${PREFIX} duplicate groups found=${dupGroups.length}`);

  if (dupGroups.length === 0) {
    console.log(`${PREFIX} database is clean — no duplicates`);
    console.log(`${PREFIX} completed`);
    return;
  }

  // ── Step 4: Process each duplicate group ──────────────────────────────────
  let totalDeleted = 0;
  let totalUpdated = 0;

  for (const rows of dupGroups) {
    const { companyId, normalizedUrl } = rows[0];
    console.log(`${PREFIX} merging group companyId=${companyId} normalizedUrl=${normalizedUrl} count=${rows.length}`);

    // Pick survivor: highest score → newest updatedAt → oldest id (deterministic tie-break)
    const scored = rows
      .map(r => ({ row: r, score: scoreRow(r) }))
      .sort((a, b) =>
        b.score - a.score ||
        b.row.updatedAt.getTime() - a.row.updatedAt.getTime() ||
        a.row.id.localeCompare(b.row.id)
      );

    const survivor = scored[0].row;
    const duplicates = scored.slice(1).map(s => s.row);

    console.log(`${PREFIX} survivor=${survivor.id} score=${scored[0].score}`);

    // Merge content from all records into the survivor
    const merged = mergeData(rows);

    if (!DRY_RUN) {
      await prisma.rawCompanyProfile.update({
        where: { id: survivor.id },
        data: { data: merged as Prisma.InputJsonValue },
      });

      // No foreign-key references to RawCompanyProfile.id from other tables — safe to delete.
      await prisma.rawCompanyProfile.deleteMany({
        where: { id: { in: duplicates.map(d => d.id) } },
      });

      console.log(`${PREFIX} deleted=${duplicates.length} ids=[${duplicates.map(d => d.id).join(', ')}]`);
    } else {
      const d = merged;
      console.log(
        `${PREFIX} [dry-run] would delete ${duplicates.length} record(s): ` +
        `[${duplicates.map(d => d.id).join(', ')}]`,
      );
      console.log(
        `${PREFIX} [dry-run] merged emails=${JSON.stringify(d.emails)} ` +
        `phones=${JSON.stringify(d.phones)} textLength=${d.text?.length ?? 0}`,
      );
    }

    totalDeleted += duplicates.length;
    totalUpdated++;
  }

  if (DRY_RUN) {
    console.log(
      `${PREFIX} [dry-run] summary: ${dupGroups.length} groups — ` +
      `would update ${totalUpdated} survivor(s), delete ${totalDeleted} duplicate(s)`,
    );
  } else {
    console.log(`${PREFIX} updated survivors=${totalUpdated} deleted duplicates=${totalDeleted}`);
  }

  // ── Step 5: Freshness summary ─────────────────────────────────────────────
  const cutoff = new Date(Date.now() - FRESHNESS_MS);
  const stale = all.filter(r => r.updatedAt < cutoff);
  console.log(
    `${PREFIX} freshness window=${FRESHNESS_DAYS}d ` +
    `fresh=${all.length - stale.length} stale=${stale.length}`,
  );

  console.log(`${PREFIX} completed`);
}

main()
  .catch((err) => {
    console.error(`${PREFIX} fatal:`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
