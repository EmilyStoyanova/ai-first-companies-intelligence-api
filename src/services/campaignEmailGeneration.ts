interface TeamMember {
  name: string;
  position?: string;
  email?: string;
  linkedin?: string;
}

export interface CampaignEmailParams {
  targetName: string;
  targetDomain: string;
  targetDescription: string;
  targetServices: string[];
  targetLocation: string;
  targetTeam: TeamMember[];

  senderCompanyName: string;
  senderWebsite: string;
  senderContactName: string;
  senderContactTitle: string;
  senderContactEmail: string;
  senderContactPhone: string;
}

type CallFn = (systemPrompt: string, userContent: string) => Promise<string>;

// Priority order: executive → sales → HR
const CONTACT_PRIORITY_PATTERNS = [
  /изпълнителен директор|CEO|управител|главен директор|president|собственик|owner/i,
  /търговски директор|sales director|commercial director|бизнес развитие|business development/i,
  /HR мениджър|HR manager|мениджър.*човешки|human resources/i,
];

function findTargetContact(team: TeamMember[]): TeamMember | undefined {
  for (const pattern of CONTACT_PRIORITY_PATTERNS) {
    const found = team.find((m) => m.position && pattern.test(m.position));
    if (found) return found;
  }
  return undefined;
}

const SYSTEM_PROMPT_TEMPLATE = `You are a B2B business development specialist writing outreach emails \
on behalf of {{senderCompanyName}} ({{senderWebsite}}).
Write in Bulgarian. Be specific and human.
Never use generic phrases. Never invent facts about the target company.`;

const USER_PROMPT_TEMPLATE = `Write a personalized B2B outreach email using EXACTLY the template below.
Rules:
- Section 1 (intro): keep word-for-word, only replace {{senderCompanyName}}
- Section 2 (about them): write 2-3 sentences showing you know their business. \
  Use only facts from the TARGET COMPANY data provided. No invented details.
- Section 3 (bullet list): copy EXACTLY, word-for-word, no changes
- Section 4 (closing): keep word-for-word, replace {{senderWebsite}}
- Signature: keep format, replace with sender data

TARGET COMPANY:
- Name: {{targetName}}
- Website: {{targetDomain}}
- Description: {{targetDescription}}
- Services/Products: {{targetServices}}
- Location: {{targetLocation}}
- Contact person (if found): {{targetContactPerson}}

SENDER:
- Company: {{senderCompanyName}}
- Website: {{senderWebsite}}
- Name: {{senderContactName}}
- Title: {{senderContactTitle}}
- Email: {{senderContactEmail}}
- Phone: {{senderContactPhone}}

EMAIL TEMPLATE (follow exactly):
---
Тема: Персонализирани софтуерни решения за Вашия бизнес – {{senderCompanyName}}

[Ако е намерен contact person от екипа: "Уважаеми г-н/г-жа [фамилия],"]
[Ако не: "Здравейте,"]

Ние от {{senderCompanyName}} сме екип от софтуерни инженери и развиваме
нашата дейност от технологичен център в гр. Враца. Специализирани сме в
разработването на софтуер, който помага на производствения сектор да
дигитализира процесите си и да премине към по-умно управление.

[2-3 изречения за конкретната компания — само на база предоставените данни.
Покажи че си запознат с тяхната дейност, продукти или пазар.]

Помагаме на производствени фирми с дигитални оптимизации, които подобряват
ефективността на работа им в следните направления:

- Управление на производство и складове: Проследимост в реално време от
  заявката до готовата продукция и наличностите.
- Автоматизация на бизнеса и доставките: Оптимизиране на веригата за
  доставки и елиминиране на документооборота на хартия.
- Свързаност между отделите: Решения, които обединяват информацията между
  производство, склад, логистика и мениджмънт.
- Интеграция на системи: Свързване на Вашите ERP, CRM и производствени
  софтуери в една обща, работеща екосистема.
- Дигитални инструменти за мениджмънт: Уеб и мобилни приложения за бързи
  управленски решения на база реални данни.

Можете да разгледате нашите проекти на {{senderWebsite}}, за да се
запознаете с опита ни отблизо.

Ще се радваме да направим кратка онлайн опознавателна среща, за да обсъдим
възможности за разработка на персонализирани софтуерни решения за вас,
които да помогнат за развитието на вашия бизнес.

Поздрави,

{{senderContactName}}
{{senderContactTitle}}
{{senderCompanyName}} – офис Враца
Моб: {{senderContactPhone}}
Email: {{senderContactEmail}}
Website: {{senderWebsite}}
---

OUTPUT: Return only the final email text. No JSON, no explanation.`;

function buildPrompts(params: CampaignEmailParams): { system: string; user: string } {
  const contact = findTargetContact(params.targetTeam);
  const targetContactPerson = contact
    ? `${contact.name}${contact.position ? ` (${contact.position})` : ''}`
    : 'не е намерен';

  const system = SYSTEM_PROMPT_TEMPLATE
    .replace(/{{senderCompanyName}}/g, params.senderCompanyName)
    .replace(/{{senderWebsite}}/g, params.senderWebsite);

  const user = USER_PROMPT_TEMPLATE
    .replace(/{{targetName}}/g, params.targetName)
    .replace(/{{targetDomain}}/g, params.targetDomain)
    .replace(/{{targetDescription}}/g, params.targetDescription || 'няма информация')
    .replace(/{{targetServices}}/g, params.targetServices.slice(0, 8).join(', ') || 'няма информация')
    .replace(/{{targetLocation}}/g, params.targetLocation || 'няма информация')
    .replace(/{{targetContactPerson}}/g, targetContactPerson)
    .replace(/{{senderCompanyName}}/g, params.senderCompanyName)
    .replace(/{{senderWebsite}}/g, params.senderWebsite)
    .replace(/{{senderContactName}}/g, params.senderContactName)
    .replace(/{{senderContactTitle}}/g, params.senderContactTitle)
    .replace(/{{senderContactEmail}}/g, params.senderContactEmail)
    .replace(/{{senderContactPhone}}/g, params.senderContactPhone);

  return { system, user };
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

export async function generateCampaignEmail(
  params: CampaignEmailParams,
  callFn: CallFn = callGroqApi,
): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[campaignEmail] GROQ_API_KEY not set — skipping');
    return null;
  }

  const { system, user } = buildPrompts(params);

  try {
    const raw = await callFn(system, user);
    const text = raw.trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    console.error('[campaignEmail] Unexpected error:', err);
    return null;
  }
}
