## 📌 Context (IMPORTANT)

You are an expert Senior Backend Engineer working in the API (-api) repository for a B2B Data Enrichment Engine.

System Overview (No Supabase)
Core Stack
FE: Next.js
API: Next.js Route Handlers
Workers: Node.js (separate process)
Crawling: Crawlee
CheerioCrawler (default)
PlaywrightCrawler (fallback)
Queue: pg-boss
DB: PostgreSQL (self-hosted или managed)
ORM: Prisma
Auth: NextAuth.js
Files: Cloudflare R2

2. High-Level Architecture
[ Next.js FE ]
      ↓
[ API Layer (Next.js) ]
      ↓
[ PostgreSQL (Data) + pg-boss (Queue) ]
      ↓
[ Worker Service (Node.js) ]
      ↓
[ Crawlee ]
      ↓
[ Extraction Pipeline (Raw → Processed) ]
      ↓
[ PostgreSQL ]
      ↓
[ Export Service ]
      ↓
[ Local Storage ]


3. Core Differences vs Supabase Setup
Area
Supabase Version
New Version
DB client
supabase-js
Prisma
Auth
Supabase Auth
NextAuth
Queue
custom SQL
pg-boss
Storage
Supabase Storage
LocalStorage 
RLS
built-in
app-level + tenant_id


4. Core Modules

4.1 Upload & Job Creation
Flow
Upload Excel/CSV
Upload file → StorageService.upload()
Save file metadata in DB
file_path
file_name
tenant_id
Parse file (xlsx / papaparse)
Normalize domains:
remove protocol
remove www
lowercase
dedupe

Create records
crawl_batch
tenant_companies
enqueue jobs via pg-boss

4.2 Multi-Tenant Data Model (Prisma)
Key principle
company shared across tenants
tenant isolation via tenant_id

Core Tables
Tenant
id
name
weeklyQuota

Company
id
domain (unique)
baseUrl
name
lastCrawledAt

TenantCompany
tenantId
companyId
sourceBatchId

CrawlBatch
id
tenantId
filePath
status
totalCompanies
processedCompanies
completionPercentage
createdAt

IMPORTANT CHANGE
You DO NOT need crawl_jobs table anymore
pg-boss replaces it.

4.3 Queue Design (pg-boss)
Job Type
queue: "crawl-company"

Payload
{
 companyId,
 domain,
 baseUrl,
 batchId,
 tenantId
}

Enqueue
await boss.send('crawl-company', payload, {
 retryLimit: 3,
 retryDelay: 60, // seconds
 retryBackoff: true
});

Worker
boss.work('crawl-company', async (job) => {
 // crawl + extract + save
});

Why pg-boss is better here
built-in retries
backoff
concurrency control
no manual locking logic
simpler than FOR UPDATE SKIP LOCKED

4.4 Crawling Strategy
Same as before (keep it):

Flow
Load homepage
Extract navigation links (nav, header)
Fallback URLs:
/about
/team
/services
/contact
/history
Crawl only selected pages

Fallback to Playwright
empty content
SPA
JS-heavy site

4.5 Extraction Pipeline
Same logic, but now you should store:

RAW → PROCESSED

RAW TABLE
RawCompanyProfile
id
companyId
baseUrl
specificUrl
data (text/json)
createdAt

PROCESSED TABLE
CompanyProfile
companyId

name
description
location

emails Json
phones Json

services Json
team Json
history String

socialLinks Json

completionScore Float
updatedAt

4.6 Completion Score
Same logic:
score = sum(fieldFound * weight)

4.7 Deduplication
if (company && lastCrawledAt < 30days && !forceRecrawl) {
 reuse
} else {
 enqueue job
}

4.8 Export System
Flow
Query DB
Generate file (CSV / XLSX)
STORAGESERVICE.SAVE()
return local API download url (example: . /API/BATCHES/ID/DOWNLOAD)

4.9 API Design
POST /batches/upload
POST /batches/upload?force_recrawl=true

GET  /batches/:id
GET  /batches/:id/companies

GET  /companies/:domain

GET  /exports/:batchId
GET /batches/:id/download (reads from STORAGESERVICE.DOWNLOAD())

4.10 Auth & Multi-Tenant
NextAuth Setup
session includes tenantId
middleware injects tenant scope

Important
You must enforce tenant filtering manually:
where: {
 tenantCompanies: {
   some: {
     tenantId: session.tenantId
   }
 }
}
No RLS safety net here.

4.11 Quotas
if (tenant.weeklyUsage + uploadedCount > weeklyQuota) {
 throw new Error("Quota exceeded")
}

4.12 Error Handling
Per job
pg-boss handles retries
after final failure → mark company as failed in DB

Per batch
always finish batch
update:
processedCompanies
completionPercentage

 V1 vs V2

V1
website crawling
pg-boss queue
deterministic extraction
RAW + processed separation
no proxies
no LLM
LocalStorage

V2
social crawling
LLM enrichment
review UI
proxy rotation
normalize JSON → relational tables 
StorageService uploads to R2

