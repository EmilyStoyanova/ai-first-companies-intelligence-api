-- Add sourceBatchId to TenantCompany composite primary key.
--
-- Previously: @@id([tenantId, companyId])
-- Now:        @@id([tenantId, companyId, sourceBatchId])
--
-- This makes TenantCompany represent batch membership (one row per tenant+company+batch)
-- instead of a mutable pointer to the latest batch. Historical batch views, exports, and
-- re-enrich operations for older batches now remain accurate after re-uploads.

-- Drop old FK so we can rebuild it as non-nullable
ALTER TABLE "TenantCompany" DROP CONSTRAINT IF EXISTS "TenantCompany_sourceBatchId_fkey";

-- Rebuild PK with sourceBatchId included (also makes the column NOT NULL implicitly via PK)
ALTER TABLE "TenantCompany" DROP CONSTRAINT "TenantCompany_pkey",
ALTER COLUMN "sourceBatchId" SET NOT NULL,
ADD CONSTRAINT "TenantCompany_pkey" PRIMARY KEY ("tenantId", "companyId", "sourceBatchId");

-- Restore FK as non-nullable
ALTER TABLE "TenantCompany" ADD CONSTRAINT "TenantCompany_sourceBatchId_fkey"
  FOREIGN KEY ("sourceBatchId") REFERENCES "CrawlBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supporting indices for tenant-scoped and batch-scoped queries
CREATE INDEX IF NOT EXISTS "TenantCompany_tenantId_idx" ON "TenantCompany"("tenantId");
CREATE INDEX IF NOT EXISTS "TenantCompany_sourceBatchId_idx" ON "TenantCompany"("sourceBatchId");
