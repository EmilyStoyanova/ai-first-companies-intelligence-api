# Companies Intelligence API

B2B Data Enrichment Engine — upload a list of company domains, crawl their websites, and extract structured profiles (emails, phones, services, social links, team members).

## Stack

- **Runtime**: Node.js + TypeScript
- **API**: Express.js
- **ORM**: Prisma
- **Database**: PostgreSQL
- **Queue**: pg-boss
- **Crawling**: Crawlee (CheerioCrawler → PlaywrightCrawler fallback)
- **Auth**: JWT (RS256)
- **Docs**: Swagger UI

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
```

Generate a strong JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Set up the database

```bash
# Create the database
psql -U your_user postgres -c "CREATE DATABASE companies_intelligence;"

# Run migrations
npm run db:migrate
```

### 4. Run the app

```bash
npm run dev
```

This starts both the API server and the worker process concurrently.

| Process | Description |
|---------|-------------|
| `[api]` | Express API on `http://localhost:3001` |
| `[worker]` | pg-boss worker that processes crawl jobs |

## API Docs

Swagger UI is available at: **http://localhost:3001/docs**

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Register a new user + tenant |
| `POST` | `/api/auth/login` | Login, receive JWT |
| `POST` | `/api/batches/upload` | Upload CSV/XLSX of domains |
| `GET` | `/api/batches/:id` | Get batch status & progress |
| `GET` | `/api/batches/:id/companies` | List companies in a batch |
| `GET` | `/api/batches/:id/download` | Download export (CSV or XLSX) |
| `GET` | `/api/companies/:domain` | Get company profile by domain |
| `GET` | `/api/exports/:batchId` | Generate export, get download URL |

All endpoints except `/api/auth/*` require a `Bearer` token in the `Authorization` header.

## Upload Format

The upload endpoint accepts `.csv` or `.xlsx` files with a column of domains:

```
domain
google.com
github.com
stripe.com
```

Domains are automatically normalized (protocol and `www` stripped, lowercased, deduped).

## How It Works

1. **Upload** — file is parsed, domains normalized, a `CrawlBatch` is created
2. **Deduplication** — companies crawled within the last 30 days are reused (override with `?force_recrawl=true`)
3. **Queue** — one pg-boss job per company is enqueued (`crawl-company` queue)
4. **Worker** — picks up jobs, crawls with CheerioCrawler; falls back to Playwright for JS-heavy/SPA sites
5. **Extraction** — extracts name, description, location, emails, phones, services, team, social links
6. **Storage** — raw HTML saved to `RawCompanyProfile`, structured data to `CompanyProfile`
7. **Export** — query results exported as CSV or XLSX

## Scripts

```bash
npm run dev          # Start API + worker (development)
npm run dev:worker   # Start worker only
npm run build        # Compile TypeScript
npm run start        # Run compiled API
npm run db:migrate   # Run Prisma migrations
npm run db:studio    # Open Prisma Studio
```

## Multi-Tenancy

Each user belongs to a tenant. All data is scoped by `tenantId` — companies, batches, and exports are fully isolated between tenants. Weekly upload quotas are enforced per tenant.
