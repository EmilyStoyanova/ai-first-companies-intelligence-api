CREATE TABLE "EmailTemplate" (
  "id"        TEXT        NOT NULL,
  "tenantId"  TEXT        NOT NULL,
  "name"      TEXT        NOT NULL,
  "subject"   TEXT        NOT NULL,
  "body"      TEXT        NOT NULL,
  "isDefault" BOOLEAN     NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrawlBatch" ADD COLUMN IF NOT EXISTS "templateId" TEXT;

ALTER TABLE "CrawlBatch" ADD CONSTRAINT "CrawlBatch_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
