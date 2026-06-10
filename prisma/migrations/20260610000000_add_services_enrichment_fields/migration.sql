ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "representedBrands" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "primaryIndustry" TEXT;
ALTER TABLE "CompanyProfile" ADD COLUMN IF NOT EXISTS "targetCustomers" TEXT;
