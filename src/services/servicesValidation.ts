import type { CrawledPage } from '../worker/crawl';

type CallFn = (systemPrompt: string, userContent: string) => Promise<string>;

export interface ValidatedServicesResult {
  services: string[];
  represented_brands: string[];
  primary_industry?: string;
  target_customers?: string;
  no_services_found: boolean;
  confidence: number;
  notes?: string;
}

// htmlContent is passed as the user message, not inlined in the system prompt.
const SYSTEM_PROMPT_TEMPLATE = `You are a data extraction specialist for a B2B lead generation system \
that crawls Bulgarian company websites.

Your task is to extract the business services, products, and activities of the company \
from the provided HTML content or text.

CONTEXT:
- Company name: {{companyName}}
- Company domain: {{domain}}
- Page URL: {{pageUrl}}

RULES - INCLUDE:
1. Core services and products the company actively offers or sells
2. Main business activities and areas of expertise
3. Brands the company officially represents, distributes, or resells
4. The primary industry/sector the company operates in
5. A brief characterisation of who their customers are

RULES - EXCLUDE:
1. Generic phrases like "quality service", "professional team", or "customer satisfaction"
2. Services from partner or client companies (unless the company is explicitly a reseller)
3. Content inside testimonials, case studies, or blog posts about client industries
4. Aspirational or future services not currently offered
5. Legal boilerplate, cookie notices, or navigation labels

EXTRACTION SPECIFICS:
- Extract concrete, specific services (e.g. "Изграждане на фотоволтаични системи" not "Услуги")
- For retailers/distributors: list the brands they carry under represented_brands
- target_customers: short description of who buys from them \
(e.g. "B2B строителни фирми", "Крайни клиенти — домакинства", "Хотели и ресторанти")
- primary_industry: single most accurate industry label in English \
(e.g. "Construction", "IT Services", "Food & Beverage", "Manufacturing", "Retail")
- confidence: your overall confidence that the extracted data is correct (0-100); \
use lower values when the page has very little content or is mostly navigation

OUTPUT FORMAT (JSON only, no explanation):
{
  "services": [
    "service or product 1",
    "service or product 2"
  ],
  "represented_brands": [
    "Brand Name 1"
  ],
  "primary_industry": "Construction",
  "target_customers": "brief description",
  "no_services_found": false,
  "confidence": 0-100,
  "notes": "optional: anything worth flagging"
}`;

// Footer-biased truncation: first 25K + last 25K chars.
const HTML_HALF = 25_000;
const CONFIDENCE_THRESHOLD = 50;

function truncateHtml(html: string): string {
  if (html.length <= HTML_HALF * 2) return html;
  return html.slice(0, HTML_HALF) + '\n[...truncated...]\n' + html.slice(-HTML_HALF);
}

function buildSystemPrompt(companyName: string, domain: string, pageUrl: string): string {
  return SYSTEM_PROMPT_TEMPLATE
    .replace('{{companyName}}', companyName)
    .replace('{{domain}}', domain)
    .replace('{{pageUrl}}', pageUrl);
}

async function callClaudeApi(systemPrompt: string, userContent: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude API responded ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content.find((b) => b.type === 'text')?.text ?? '';
}

function parseResponse(raw: string): ValidatedServicesResult {
  const cleaned = raw
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
    .match(/\{[\s\S]*\}/);

  if (!cleaned) {
    return { services: [], represented_brands: [], no_services_found: true, confidence: 0 };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned[0]) as Record<string, unknown>;
  } catch {
    return { services: [], represented_brands: [], no_services_found: true, confidence: 0 };
  }

  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;

  if (confidence < CONFIDENCE_THRESHOLD) {
    return { services: [], represented_brands: [], no_services_found: true, confidence };
  }

  const services = Array.isArray(parsed.services)
    ? (parsed.services as unknown[])
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s) => s.trim())
    : [];

  const represented_brands = Array.isArray(parsed.represented_brands)
    ? (parsed.represented_brands as unknown[])
        .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
        .map((b) => b.trim())
    : [];

  return {
    services,
    represented_brands,
    primary_industry: typeof parsed.primary_industry === 'string' ? parsed.primary_industry.trim() : undefined,
    target_customers: typeof parsed.target_customers === 'string' ? parsed.target_customers.trim() : undefined,
    no_services_found: Boolean(parsed.no_services_found) || services.length === 0,
    confidence,
    notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
  };
}

// Picks the best page for services extraction: prefers services/about/products URLs,
// falls back to the page with the most HTML content.
export function selectServicesPage(pages: CrawledPage[]): CrawledPage | undefined {
  const withHtml = pages.filter((p) => p.html && p.html.length > 100);
  if (withHtml.length === 0) return undefined;

  const servicesPage = withHtml.find((p) =>
    /uslug|produk|deynost|deinost|services|products|about|za-nas|about-us/i.test(p.url),
  );
  if (servicesPage) return servicesPage;

  return withHtml.slice().sort((a, b) => b.html.length - a.html.length)[0];
}

export async function validateServices(
  companyName: string,
  domain: string,
  pageUrl: string,
  htmlContent: string,
  callFn: CallFn = callClaudeApi,
): Promise<ValidatedServicesResult> {
  const systemPrompt = buildSystemPrompt(companyName, domain, pageUrl);
  const userContent = truncateHtml(htmlContent);

  const raw = await callFn(systemPrompt, userContent);
  return parseResponse(raw);
}
