-- Create PersonalizedContent if it does not exist (was originally added via db push)
CREATE TABLE IF NOT EXISTS "PersonalizedContent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "emailSubject" TEXT,
    "openingLine" TEXT,
    "valueProposition" TEXT,
    "fullMessage" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalizedContent_pkey" PRIMARY KEY ("id")
);

-- Evolve PersonalizedContent table to match new schema
-- Remove legacy columns added by a prior db push (not tracked in migrations)
ALTER TABLE "PersonalizedContent" DROP COLUMN IF EXISTS "batchId";
ALTER TABLE "PersonalizedContent" DROP COLUMN IF EXISTS "factsUsed";
ALTER TABLE "PersonalizedContent" DROP COLUMN IF EXISTS "status";
ALTER TABLE "PersonalizedContent" DROP COLUMN IF EXISTS "updatedAt";

-- Rename createdAt → generatedAt (schema field name change)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'PersonalizedContent' AND column_name = 'createdAt'
  ) THEN
    ALTER TABLE "PersonalizedContent" RENAME COLUMN "createdAt" TO "generatedAt";
  END IF;
END $$;

-- Add generatedAt if it still doesn't exist (idempotent)
ALTER TABLE "PersonalizedContent" ADD COLUMN IF NOT EXISTS "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add UNIQUE constraint on companyId if not already present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'PersonalizedContent' AND indexname = 'PersonalizedContent_companyId_key'
  ) THEN
    CREATE UNIQUE INDEX "PersonalizedContent_companyId_key" ON "PersonalizedContent"("companyId");
  END IF;
END $$;

-- Remove legacy columns from CompanyProfile (removed from schema)
ALTER TABLE "CompanyProfile" DROP COLUMN IF EXISTS "foundingYear";
ALTER TABLE "CompanyProfile" DROP COLUMN IF EXISTS "industry";

-- AddForeignKey (idempotent: skip if constraint already exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PersonalizedContent_companyId_fkey'
  ) THEN
    ALTER TABLE "PersonalizedContent" ADD CONSTRAINT "PersonalizedContent_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
