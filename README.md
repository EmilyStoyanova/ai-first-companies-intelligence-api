# AI Companies Intelligence — API

B2B Data Enrichment Engine — upload a list of company domains, crawl their websites, and extract structured profiles (emails, phones, services, social links, team members).

> The frontend lives in a separate repo: [`-ai-first-companies-intelligence-fe`](../-ai-first-companies-intelligence-fe)

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + TypeScript |
| API | Express.js |
| ORM | Prisma |
| Database | PostgreSQL |
| Queue | pg-boss |
| Crawling | Crawlee (CheerioCrawler → PlaywrightCrawler fallback) |
| Auth | JWT |
| Docs | Swagger UI |
| Email | Nodemailer (console fallback in dev) |

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL="postgresql://your_user@localhost:5432/companies_intelligence"
JWT_SECRET="your-secret-key"
PORT=3001
STORAGE_BASE_PATH="./storage"
WORKER_CONCURRENCY=5

# Optional — email confirmation (dev mode logs the link to console if omitted)
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=you@example.com
EMAIL_PASS=yourpassword
EMAIL_FROM=noreply@example.com
APP_URL=http://localhost:3001
```

Generate a strong JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Set up the database

```bash
psql -U your_user postgres -c "CREATE DATABASE companies_intelligence;"
npm run db:migrate
```

### 4. Run the app

```bash
npm run dev
```

This starts both the API server and the worker process concurrently.

| Process | URL |
|---------|-----|
| API server | http://localhost:3001 |
| Swagger UI | http://localhost:3001/docs |
| Frontend | http://localhost:3000 (separate process) |

## API Endpoints

All endpoints except `/api/auth/*` require `Authorization: Bearer <token>`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Register user + tenant, receive JWT |
| `POST` | `/api/auth/login` | Login, receive JWT |
| `GET` | `/api/auth/confirm-email?token=` | Confirm email from link |
| `POST` | `/api/batches/upload` | Upload CSV/XLSX of domains |
| `GET` | `/api/batches` | List all batches for tenant |
| `GET` | `/api/batches/:id` | Get batch status & progress |
| `GET` | `/api/batches/:id/companies` | Paginated company list |
| `GET` | `/api/batches/:id/download?format=csv\|xlsx` | Download export |
| `DELETE` | `/api/batches/:id` | Delete batch |
| `GET` | `/api/companies/:domain` | Get company profile by domain |

## Upload Format

`.csv` or `.xlsx` with a `domain` or `website` column:

```
domain
google.com
github.com
stripe.com
```

Domains are normalized automatically (protocol stripped, `www` removed, lowercased, deduped). Pass `?force_recrawl=true` to bypass the 30-day cache.

## How It Works

1. **Upload** — file parsed, domains normalized, `CrawlBatch` created, one pg-boss job per company enqueued
2. **Deduplication** — companies crawled within 30 days are reused unless `force_recrawl=true`
3. **Crawl** — CheerioCrawler fetches homepage + nav links + fallback paths (`/about`, `/team`, `/services`, `/contact`); falls back to Playwright for JS-heavy sites
4. **Extract** — name, description, location, emails, phones, services, team members (name/position/email), social links, completion score
5. **Store** — raw pages → `RawCompanyProfile`; structured data → `CompanyProfile`
6. **Export** — query results streamed as CSV or XLSX

## Scripts

```bash
npm run dev           # Start API + worker (development)
npm run dev:api       # API server only
npm run dev:worker    # Worker only
npm run build         # Compile TypeScript
npm run start         # Run compiled API
npm run db:migrate    # Run Prisma migrations
npm run db:studio     # Open Prisma Studio
```

## Multi-Tenancy

Each user belongs to a tenant. All data (batches, companies, exports) is scoped by `tenantId`. Weekly upload quotas are enforced per tenant.
