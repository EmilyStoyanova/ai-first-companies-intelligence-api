import Tesseract from 'tesseract.js';
import { extractNameFromLogoFilename } from './logoExtraction';

// Words that appear on login pages themselves — if OCR returns only these,
// the image is part of the login form UI, not the company logo.
const GENERIC_WORDS = new Set([
  'login', 'log in', 'sign in', 'signin', 'sign-in',
  'welcome', 'username', 'password', 'email', 'e-mail',
  'portal', 'customer', 'area', 'user', 'enter',
  'access', 'secure', 'system', 'platform', 'account',
  'forgot', 'remember', 'continue', 'submit', 'register',
  'вход', 'парола', 'потребител', 'клиент', 'система',
]);

export interface OcrResult {
  companyNameFromLogo: string;
  sloganFromLogo?: string;
  logoNameConfidence: number;
  logoSourceUrl: string;
}

function isGenericWord(text: string): boolean {
  return GENERIC_WORDS.has(text.toLowerCase().trim());
}

// Compute a 0–100 confidence that a given OCR line is a real company/brand name.
function scoreCandidate(line: string): number {
  const t = line.trim();
  if (t.length < 2) return 0;
  if (isGenericWord(t)) return 0;

  // Reject lines that start with common non-brand patterns
  if (/^(https?|www\.|[0-9]+$)/.test(t)) return 0;
  // Must contain at least one letter (Latin or Cyrillic)
  if (!/[a-zA-ZЀ-ӿ]/.test(t)) return 0;
  // Reject lines that look like sentences (punctuation at end, very long)
  if (/[.!?,]$/.test(t) && t.length > 30) return 0;

  let score = 40;

  // All-uppercase → strong brand signal
  if (t === t.toUpperCase() && t.length > 2) score += 25;
  // Reasonable brand-name length
  if (t.length >= 3 && t.length <= 35) score += 15;
  // Looks like a proper name: each word starts with uppercase
  if (/^[\p{Lu}][\p{Ll}\p{Lo}]+(?:\s[\p{Lu}][\p{Ll}\p{Lo}]+)*$/u.test(t)) score += 10;
  // Contains "LTD", "EOOD", "OOD", "AD", "JSC" → company suffix
  if (/\b(ltd|eood|ood|ad|jsc|inc|corp|gmbh|srl|bv|nv)\b/i.test(t)) score += 10;
  // Penalise suspiciously long lines (probably a slogan, not a name)
  if (t.length > 40) score -= 20;

  return Math.min(100, Math.max(0, score));
}

function parseOcrText(rawText: string): { name?: string; slogan?: string; confidence: number } {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  if (lines.length === 0) return { confidence: 0 };

  let bestLine = '';
  let bestScore = 0;
  let sloganLine = '';

  for (const line of lines) {
    const score = scoreCandidate(line);
    if (score > bestScore) {
      if (bestLine && bestScore >= 30) sloganLine = bestLine;
      bestLine = line;
      bestScore = score;
    } else if (score >= 30 && line !== bestLine && !sloganLine) {
      sloganLine = line;
    }
  }

  if (bestScore < 30 || !bestLine) return { confidence: 0 };

  return {
    name: bestLine,
    slogan: sloganLine || undefined,
    confidence: bestScore,
  };
}

const OCR_TIMEOUT_MS = 20_000;

async function ocrBuffer(buf: Buffer): Promise<string> {
  // Try with Bulgarian + English first for Cyrillic brand names.
  // tesseract.js downloads language data on first use.
  try {
    const { data: { text } } = await Tesseract.recognize(buf, 'bul+eng', {
      logger: () => { /* suppress progress logs */ },
    });
    return text;
  } catch {
    // Language pack unavailable — fall back to English only
    const { data: { text } } = await Tesseract.recognize(buf, 'eng', {
      logger: () => { /* suppress progress logs */ },
    });
    return text;
  }
}

export async function runLogoOcr(imageUrl: string): Promise<OcrResult | null> {
  try {
    // Fetch the image with a short timeout
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(8_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompanyEnrichmentBot/1.0)' },
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') ?? '';
    // SVG is a vector format — tesseract can't handle it; use filename fallback
    if (contentType.includes('svg') || imageUrl.toLowerCase().includes('.svg')) {
      const filenameHint = extractNameFromLogoFilename(imageUrl);
      if (!filenameHint) return null;
      return {
        companyNameFromLogo: filenameHint,
        logoNameConfidence: 30, // low confidence — derived from filename only
        logoSourceUrl: imageUrl,
      };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength < 200) return null; // Ignore 1×1 pixel trackers etc.

    // Wrap OCR in a timeout so slow images don't stall the entire pipeline
    const ocrText = await Promise.race([
      ocrBuffer(buffer),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), OCR_TIMEOUT_MS)),
    ]);

    if (!ocrText.trim()) {
      // OCR returned nothing — attempt filename fallback
      const filenameHint = extractNameFromLogoFilename(imageUrl);
      if (!filenameHint) return null;
      return {
        companyNameFromLogo: filenameHint,
        logoNameConfidence: 30,
        logoSourceUrl: imageUrl,
      };
    }

    const parsed = parseOcrText(ocrText);
    if (parsed.confidence === 0 || !parsed.name) {
      const filenameHint = extractNameFromLogoFilename(imageUrl);
      if (!filenameHint) return null;
      return {
        companyNameFromLogo: filenameHint,
        logoNameConfidence: 30,
        logoSourceUrl: imageUrl,
      };
    }

    return {
      companyNameFromLogo: parsed.name,
      sloganFromLogo: parsed.slogan,
      logoNameConfidence: parsed.confidence,
      logoSourceUrl: imageUrl,
    };
  } catch {
    return null;
  }
}
