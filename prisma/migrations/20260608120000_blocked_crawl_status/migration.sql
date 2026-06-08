-- Add BLOCKED to CrawlStatus enum and crawlNote to Company.
--
-- BLOCKED is set when automated crawling is stopped by bot protection
-- (Cloudflare challenge, CAPTCHA, access denied).
-- crawlNote carries a human-readable reason surfaced in the UI and exports.

ALTER TYPE "CrawlStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "crawlNote" TEXT;
