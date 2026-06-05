interface ProfileInput {
  name?: string;
  description?: string;
  location?: string;
  services: string[];
  team: Array<{ name: string; position?: string }>;
  history?: string;
  emails: string[];
}

export interface PersonalizedOutput {
  emailSubject?: string;
  openingLine?: string;
  valueProposition?: string;
  fullMessage?: string;
}

function buildProfileContext(profile: ProfileInput): string {
  const lines: string[] = [];

  if (profile.name)        lines.push(`Company name: ${profile.name}`);
  if (profile.description) lines.push(`About: ${profile.description}`);
  if (profile.location)    lines.push(`Location: ${profile.location}`);

  if (profile.services.length > 0) {
    lines.push(`Services/Products: ${profile.services.slice(0, 10).join(', ')}`);
  }

  if (profile.team.length > 0) {
    const members = profile.team.slice(0, 5)
      .map((m) => (m.position ? `${m.name} (${m.position})` : m.name))
      .join(', ');
    lines.push(`Key people: ${members}`);
  }

  if (profile.history) {
    lines.push(`Background: ${profile.history.slice(0, 300)}`);
  }

  return lines.join('\n');
}

export async function generatePersonalizedContent(
  profile: ProfileInput,
): Promise<PersonalizedOutput | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[personalization] GROQ_API_KEY not set — skipping');
    return null;
  }

  const context = buildProfileContext(profile);
  if (!context.trim()) {
    console.warn('[personalization] No usable profile data — skipping');
    return null;
  }

  const prompt = `You are a B2B sales expert writing personalized cold outreach emails.

Based on the following company information, generate a personalized B2B outreach email.

Company information:
${context}

Generate a JSON object with exactly these fields:
{
  "emailSubject": "short compelling subject line, under 60 characters",
  "openingLine": "personalized first sentence referencing something specific about this company (1-2 sentences)",
  "valueProposition": "how you can add value to their specific business (1-2 sentences)",
  "fullMessage": "complete professional email body (3-4 short paragraphs, professional but conversational tone, no greeting or sign-off)"
}

Rules:
- Use ONLY facts from the provided company information
- Do NOT invent facts, numbers, or specific claims not present in the data
- If information is limited, write an honest general outreach without fabricating details
- Output ONLY valid JSON with no additional text or markdown fences

JSON:`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 700,
      }),
    });

    if (!res.ok) {
      console.warn(`[personalization] Groq API responded ${res.status} — skipping`);
      return null;
    }

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const raw = (data.choices[0]?.message?.content ?? '').trim();

    // Strip markdown code fences if present, then extract JSON object
    const jsonMatch = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[personalization] No JSON object in Groq response — storing raw text as fullMessage');
      return raw.length > 0 ? { fullMessage: raw.slice(0, 2000) } : null;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch {
      console.warn('[personalization] JSON.parse failed — storing raw text as fullMessage');
      return raw.length > 0 ? { fullMessage: raw.slice(0, 2000) } : null;
    }

    return {
      emailSubject:     typeof parsed.emailSubject     === 'string' ? parsed.emailSubject     : undefined,
      openingLine:      typeof parsed.openingLine      === 'string' ? parsed.openingLine      : undefined,
      valueProposition: typeof parsed.valueProposition === 'string' ? parsed.valueProposition : undefined,
      fullMessage:      typeof parsed.fullMessage      === 'string' ? parsed.fullMessage      : undefined,
    };
  } catch (err) {
    console.error('[personalization] Unexpected error:', err);
    return null;
  }
}
