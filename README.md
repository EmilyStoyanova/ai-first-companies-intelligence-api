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
| Discovery | Brave Search API + Groq (llama-3.1-8b-instant) relevance filter |
| Auth | JWT |
| Docs | Swagger UI |
| Email | Nodemailer (console fallback in dev) |

## Running with Docker (recommended)

The easiest way to run the full stack. Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

### 1. Get the files

Two files are needed:
- `docker-compose.yml`
- `.env` 

### 2. Start the stack

```bash
docker-compose up -d
```

Docker pulls the images automatically — no code or build required.

### 3. First run only — apply database migrations

```bash
docker-compose exec api npx prisma migrate deploy
docker-compose exec api npx prisma db push
```

### 4. Open the app

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| API | http://localhost:3001 |
| Swagger UI | http://localhost:3001/docs |

### Day-to-day commands

```bash
docker-compose up -d    # start
docker-compose down     # stop
docker-compose logs -f  # view logs
```

---

## Local Development

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

# Persona search — Brave Search API (free tier: 2,000 queries/month)
# https://api.search.brave.com
BRAVE_SEARCH_API_KEY=your-brave-key

# Relevance filter — Groq API (free tier, llama-3.1-8b-instant)
# https://console.groq.com — optional, degrades gracefully if unset
GROQ_API_KEY=your-groq-key

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
| `POST` | `/api/persona-searches` | Start a persona-based lead discovery search |

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

### Upload flow (domain list)

1. **Upload** — file parsed, domains normalized, `CrawlBatch` created, one pg-boss job per company enqueued
2. **Deduplication** — companies crawled within 30 days are reused unless `force_recrawl=true`
3. **Crawl** — CheerioCrawler fetches homepage + nav links + fallback paths (`/about`, `/team`, `/services`, `/contact`); falls back to Playwright for JS-heavy sites; hard 60 s timeout per domain
4. **Extract** — name, description, location, emails, phones, services, team members (name/position/email), social links, completion score
5. **Store** — raw pages → `RawCompanyProfile`; structured data → `CompanyProfile`
6. **Export** — query results streamed as CSV or XLSX

### Persona search flow (lead discovery)

1. **Search** — three query variations (`официален сайт`, `контакти`, `услуги`) fire in parallel against Brave Search (20 results each, up to 60 candidates)
2. **Filter** — static `SKIP_DOMAINS` blocklist removes known directories; Groq (`llama-3.1-8b-instant`) classifies remaining candidates and keeps only single-company official websites
3. **Enqueue** — surviving domains are upserted as companies and enqueued as crawl jobs, same pipeline as the upload flow

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
