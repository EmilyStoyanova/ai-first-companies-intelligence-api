-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('KEPT', 'FILTERED', 'BLOCKED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "BatchSourceType" AS ENUM ('UPLOAD', 'PERSONA_SEARCH');

-- AlterTable
ALTER TABLE "CrawlBatch" ADD COLUMN     "searchQuery" JSONB,
ADD COLUMN     "sourceType" "BatchSourceType" NOT NULL DEFAULT 'UPLOAD';

-- AlterTable
ALTER TABLE "TenantCompany" ADD COLUMN     "excluded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerificationToken" TEXT,
ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DiscoveryCandidate" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "snippet" TEXT,
    "status" "CandidateStatus" NOT NULL DEFAULT 'KEPT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryCandidate_batchId_domain_key" ON "DiscoveryCandidate"("batchId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "User_emailVerificationToken_key" ON "User"("emailVerificationToken");

-- AddForeignKey
ALTER TABLE "DiscoveryCandidate" ADD CONSTRAINT "DiscoveryCandidate_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CrawlBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
