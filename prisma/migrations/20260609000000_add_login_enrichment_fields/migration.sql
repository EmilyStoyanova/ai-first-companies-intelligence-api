-- Add login-page fallback enrichment fields to CompanyProfile
ALTER TABLE "CompanyProfile" ADD COLUMN "loginProtected"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompanyProfile" ADD COLUMN "logoSourceUrl"       TEXT;
ALTER TABLE "CompanyProfile" ADD COLUMN "companyNameFromLogo" TEXT;
ALTER TABLE "CompanyProfile" ADD COLUMN "sloganFromLogo"      TEXT;
ALTER TABLE "CompanyProfile" ADD COLUMN "logoNameConfidence"  INTEGER NOT NULL DEFAULT 0;
