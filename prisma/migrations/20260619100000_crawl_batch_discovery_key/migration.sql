ALTER TABLE "CrawlBatch" ADD COLUMN "discoveryKey" TEXT;

CREATE INDEX "CrawlBatch_discoveryKey_idx" ON "CrawlBatch"("discoveryKey");
CREATE INDEX "CrawlBatch_sourceType_status_discoveryKey_updatedAt_idx" ON "CrawlBatch"("sourceType", "status", "discoveryKey", "updatedAt");
