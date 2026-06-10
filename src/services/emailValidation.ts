import type { CrawledPage } from '../worker/crawl';

export interface ValidatedEmail {
  email: string;
  type: 'primary' | 'secondary' | 'personal';
  personal_domain: boolean;
  domain_match: boolean;
  source_context: string;
  confidence: number;
}

export interface EmailValidationResult {
  verified: string[];
  unverified: ValidatedEmail[];
  no_emails_found: boolean;
  notes?: string;
}

type CallFn = (systemPrompt: string, userContent: string) => Promise<string>;

// Prompt template — htmlContent is passed as the user message, not inline here.
const SYSTEM_PROMPT_TEMPLATE = `You are a data extraction specialist for a B2B lead generation system \
that crawls Bulgarian company websites.

Your task is to extract ONLY real business contact email addresses from \
the provided HTML content or text.

CONTEXT:
- Company name: {{companyName}}
- Company domain: {{domain}}
- Page URL: {{pageUrl}}

RULES - INCLUDE only emails that:
1. Belong to the company's own domain (e.g. info@yotovstone.com)
2. Are on a contact, about, or footer section
3. Are clearly intended as business contact emails

RULES - EXCLUDE:
1. Emails from third-party domains unrelated to the company
2. Example/placeholder emails (example@, test@, noreply@, no-reply@)
3. Emails that appear in script tags, tracking pixels, or hidden elements
4. Personal emails (gmail.com, abv.bg, yahoo.com) UNLESS no company \
domain email exists — in that case flag them separately
5. Emails found only in meta tags or structured data without visible \
confirmation on the page
6. Duplicate emails (return unique only)

SPECIAL CASES for Bulgarian market:
- abv.bg, mail.bg, dir.bg emails are common for small Bulgarian businesses \
— include them but mark as "personal_domain": true
- If the domain has a typo variant (e.g. yotovstones.com vs yotovstone.com) \
flag it as "domain_mismatch": true

OUTPUT FORMAT (JSON only, no explanation):
{
  "emails": [
    {
      "email": "info@company.com",
      "type": "primary|secondary|personal",
      "personal_domain": false,
      "domain_match": true,
      "source_context": "short snippet of surrounding text where found",
      "confidence": 0-100
    }
  ],
  "no_emails_found": false,
  "notes": "optional: anything suspicious or worth flagging"
}`;

const HTML_TRUNCATE_CHARS = 50_000;
const CONFIDENCE_THRESHOLD = 70;

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

function parseResponse(raw: string): EmailValidationResult {
  const cleaned = raw
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
    .match(/\{[\s\S]*\}/);

  if (!cleaned) {
    return { verified: [], unverified: [], no_emails_found: true };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned[0]) as Record<string, unknown>;
  } catch {
    return { verified: [], unverified: [], no_emails_found: true };
  }

  const rawEmails = Array.isArray(parsed.emails) ? parsed.emails as unknown[] : [];
  const verified: string[] = [];
  const unverified: ValidatedEmail[] = [];

  for (const item of rawEmails) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const email = typeof e.email === 'string' ? e.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) continue;

    const validated: ValidatedEmail = {
      email,
      type: (e.type === 'primary' || e.type === 'secondary' || e.type === 'personal')
        ? e.type
        : 'secondary',
      personal_domain: Boolean(e.personal_domain),
      domain_match: e.domain_match !== false,
      source_context: typeof e.source_context === 'string' ? e.source_context.slice(0, 200) : '',
      confidence: typeof e.confidence === 'number' ? e.confidence : 0,
    };

    if (validated.confidence >= CONFIDENCE_THRESHOLD) {
      verified.push(email);
    } else {
      unverified.push(validated);
    }
  }

  return {
    verified,
    unverified,
    no_emails_found: Boolean(parsed.no_emails_found) || verified.length + unverified.length === 0,
    notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
  };
}

// Picks the best page to validate: prefers contact/about URLs, falls back to
// whichever page has the most email addresses.
export function selectPageForValidation(pages: CrawledPage[]): CrawledPage | undefined {
  const withHtml = pages.filter((p) => p.html && p.html.length > 100);
  if (withHtml.length === 0) return undefined;

  const contact = withHtml.find((p) =>
    /kontakt|contact|about|za-nas|about-us|\bcontacte?\b/i.test(p.url),
  );
  if (contact) return contact;

  return withHtml.sort((a, b) => b.emails.length - a.emails.length)[0];
}

export async function validateEmails(
  companyName: string,
  domain: string,
  pageUrl: string,
  htmlContent: string,
  callFn: CallFn = callClaudeApi,
): Promise<EmailValidationResult> {
  const systemPrompt = buildSystemPrompt(companyName, domain, pageUrl);
  const userContent = htmlContent.length > HTML_TRUNCATE_CHARS
    ? htmlContent.slice(0, HTML_TRUNCATE_CHARS)
    : htmlContent;

  const raw = await callFn(systemPrompt, userContent);
  return parseResponse(raw);
}
