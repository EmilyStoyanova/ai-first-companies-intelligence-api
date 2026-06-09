import * as cheerio from 'cheerio';

// Keywords that indicate a login/authentication page
const LOGIN_KEYWORDS = [
  'login', 'log in', 'sign in', 'signin', 'sign-in',
  'вход', 'парола', 'потребител',
  'username', 'password', 'forgot password',
];

// Keywords that confirm authentication-focused content
const AUTH_CONTENT_RE = /\b(login|log\s*in|sign[\s\-]?in|вход|парола|потребител|username|password|forgot|remember\s*me|create\s*account|register)\b/i;

export interface LoginPageInfo {
  loginProtected: boolean;
}

export function detectLoginPage(html: string, text: string): LoginPageInfo {
  if (!html) return { loginProtected: false };

  const $ = cheerio.load(html);

  // Strong structural signal: a password input field
  const hasPasswordInput = $('input[type="password"]').length > 0;
  if (!hasPasswordInput) return { loginProtected: false };

  // Count login-related keywords in visible text
  const textLower = text.toLowerCase();
  const keywordMatches = LOGIN_KEYWORDS.filter((kw) => textLower.includes(kw)).length;

  // Login pages have very little non-auth text; meaningful pages have descriptions,
  // services, team sections etc. Strip auth keywords and see what's left.
  const strippedText = text.replace(AUTH_CONTENT_RE, '').replace(/\s+/g, ' ').trim();
  const meaningfulLength = strippedText.length;

  // It's a login page when:
  //   • has a password input
  //   • has at least 1 auth keyword
  //   • very little meaningful non-auth content (< 1500 chars after stripping auth terms)
  const loginProtected = hasPasswordInput && keywordMatches >= 1 && meaningfulLength < 1500;

  return { loginProtected };
}
