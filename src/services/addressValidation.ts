type CallFn = (systemPrompt: string, userContent: string) => Promise<string>;

export interface ValidatedAddress {
  full_address: string;
  source: 'website' | 'search';
  confidence: number;
  note?: string;
}

export interface AddressValidationResult {
  primary?: ValidatedAddress;
  alternative?: ValidatedAddress;
  no_address_found: boolean;
  notes?: string;
}

const SYSTEM_PROMPT_TEMPLATE = `You are a data extraction specialist for a B2B lead generation system \
that crawls Bulgarian company websites.

Your task is to extract the physical business address of the company.
You have TWO sources: the company's own website HTML and search-based \
candidates found via web search.

CONTEXT:
- Company name: {{companyName}}
- Company domain: {{domain}}
- Website address candidate: {{websiteAddress}}
- Search address candidates:
{{searchCandidates}}

SOURCE PRIORITY RULES:
1. ALWAYS prefer the address found directly on the company's own website
2. Use search candidates ONLY if the website has no address at all
3. If both exist and differ — return the website address as primary, \
include the search address as alternative with a note
4. Never mix parts from different sources into one address
5. full_address must contain EXACTLY ONE address — never join multiple addresses \
with separators like "|", "/", or newlines

VALIDATION RULES — REJECT a candidate if it:
1. Contains only a city or region without a street (e.g. "Vratsa" alone)
2. Is a P.O. box
3. Belongs to a different company mentioned on the page
4. Appears only in a testimonial, partner list, or blog content
5. Looks like SEO text or page title fragments \
(e.g. "Predsednik Vratsa stone. Анкетна карта. Компания · Колекция")
6. Contains navigation elements: "·", "...", menu item names

BULGARIAN ADDRESS SPECIFICS:
- Valid formats:
    "BG-3040 Beli Izvor, Vratza"
    "ул. Георги Проданов 21, 3042 Згориград"
    "бул. Стефан Стамболов 5, 3000 Враца"
- Street prefixes: ул., бул., пл., кв., ж.к., бл., вх., ет., ап.
- Postal codes: 4-digit Bulgarian (1000-9999), or BG-XXXX format
- Latin transliterations are valid: "ul.", "bul.", "BG-3040 Beli Izvor"

OUTPUT FORMAT (JSON only, no explanation):
{
  "primary": {
    "full_address": "BG-3040 Beli Izvor, Vratza",
    "source": "website",
    "confidence": 0-100
  },
  "alternative": {
    "full_address": "ул. Георги Проданов 21, 3042 Згориград",
    "source": "search",
    "confidence": 0-100,
    "note": "Found via search — differs from website address"
  },
  "no_address_found": false,
  "notes": "optional: explanation if sources conflict"
}`;

const CONFIDENCE_THRESHOLD = 60;

function buildSystemPrompt(
  companyName: string,
  domain: string,
  websiteAddress: string,
  searchCandidates: string[],
): string {
  const candidateStr = searchCandidates.length > 0
    ? searchCandidates.map((c, i) => `  ${i + 1}. ${c}`).join('\n')
    : '  (none found)';
  return SYSTEM_PROMPT_TEMPLATE
    .replace('{{companyName}}', companyName)
    .replace('{{domain}}', domain)
    .replace('{{websiteAddress}}', websiteAddress || '(none found on website)')
    .replace('{{searchCandidates}}', candidateStr);
}

async function callGroqApi(systemPrompt: string, userContent: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq API responded ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? '';
}

function parseValidatedAddress(obj: unknown): ValidatedAddress | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const a = obj as Record<string, unknown>;
  const raw_address = typeof a.full_address === 'string' ? a.full_address.trim() : '';
  if (!raw_address) return undefined;
  // Take only the first address if the model joined multiple with a separator
  const full_address = raw_address.split(/\s*\|\s*/)[0].trim();
  const confidence = typeof a.confidence === 'number' ? a.confidence : 0;
  if (confidence < CONFIDENCE_THRESHOLD) return undefined;
  return {
    full_address,
    source: a.source === 'website' ? 'website' : 'search',
    confidence,
    note: typeof a.note === 'string' ? a.note : undefined,
  };
}

function parseResponse(raw: string): AddressValidationResult {
  const cleaned = raw
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
    .match(/\{[\s\S]*\}/);

  if (!cleaned) return { no_address_found: true };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned[0]) as Record<string, unknown>;
  } catch {
    return { no_address_found: true };
  }

  const primary = parseValidatedAddress(parsed.primary);
  const alternative = parseValidatedAddress(parsed.alternative);

  return {
    primary,
    alternative,
    no_address_found: Boolean(parsed.no_address_found) || !primary,
    notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
  };
}

export async function validateAddress(
  companyName: string,
  domain: string,
  websiteAddress: string,
  searchCandidates: string[],
  callFn: CallFn = callGroqApi,
): Promise<AddressValidationResult> {
  const systemPrompt = buildSystemPrompt(companyName, domain, websiteAddress, searchCandidates);
  const raw = await callFn(systemPrompt, `Validate address candidates for ${companyName} (${domain}).`);
  return parseResponse(raw);
}
