-- Add normalizedUrl and updatedAt to RawCompanyProfile, deduplicate inline,
-- then add the unique constraint — all in a single migration so prisma migrate
-- deploy works in one step without any script prerequisite.
--
-- After this migration, run the cleanup script for content-aware re-normalisation
-- (strips trailing slashes, www, tracking params, etc.) and content merging:
--
--   npm run cleanup:raw-profiles -- --dry-run
--   npm run cleanup:raw-profiles -- --apply

-- ── 1. Add columns ─────────────────────────────────────────────────────────

ALTER TABLE "RawCompanyProfile"
  ADD COLUMN "normalizedUrl" TEXT,
  ADD COLUMN "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ── 2. Seed normalizedUrl with specificUrl as a starting value ─────────────
-- The cleanup script will re-normalise these to canonical form
-- (https, no www, no trailing slash, no tracking params).

UPDATE "RawCompanyProfile"
SET "normalizedUrl" = "specificUrl";

-- ── 3. Lock normalizedUrl to NOT NULL now that all rows are filled ──────────

ALTER TABLE "RawCompanyProfile"
  ALTER COLUMN "normalizedUrl" SET NOT NULL;

-- ── 4. Remove exact-URL duplicates before adding the unique index ───────────
-- Keeps the row with the most recent createdAt per (companyId, normalizedUrl).
-- Content merging across semantically-equivalent URLs (e.g. /contact vs /contact/)
-- is handled by the cleanup script after migration.

DELETE FROM "RawCompanyProfile"
WHERE id NOT IN (
  SELECT DISTINCT ON ("companyId", "normalizedUrl") id
  FROM "RawCompanyProfile"
  ORDER BY "companyId", "normalizedUrl", "createdAt" DESC
);

-- ── 5. Add unique index ─────────────────────────────────────────────────────

CREATE UNIQUE INDEX "RawCompanyProfile_companyId_normalizedUrl_key"
  ON "RawCompanyProfile"("companyId", "normalizedUrl");
