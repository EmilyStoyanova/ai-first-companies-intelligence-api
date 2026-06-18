-- CreateTable
CREATE TABLE "SearchCache" (
    "id" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "results" JSONB NOT NULL DEFAULT '[]',
    "lastSearchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SearchCache_normalizedQuery_key" ON "SearchCache"("normalizedQuery");

-- CreateIndex
CREATE INDEX "SearchCache_lastSearchedAt_idx" ON "SearchCache"("lastSearchedAt");
