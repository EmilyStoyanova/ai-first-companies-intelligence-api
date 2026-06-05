-- Restore JSONB columns removed by a prior migration that is no longer in the repo.
-- These are required by the current schema.prisma and the extraction worker.
ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "emails"      JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "phones"      JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "services"    JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "team"        JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "socialLinks" JSONB NOT NULL DEFAULT '{}';
