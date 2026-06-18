-- Mark known social platform domains as BLOCKED to prevent future re-crawls.
-- These should never have been accepted as company domains.
-- Records are preserved for audit purposes; only crawlStatus is updated.
UPDATE "Company"
SET    "crawlStatus" = 'BLOCKED',
       "crawlNote"   = 'social_platform_domain: not a company website'
WHERE  "domain" IN (
  'facebook.com', 'fb.com',
  'linkedin.com',
  'instagram.com',
  'youtube.com', 'youtu.be',
  'tiktok.com',
  'x.com', 'twitter.com',
  'threads.net',
  'pinterest.com',
  'snapchat.com'
)
AND "crawlStatus" != 'BLOCKED';
