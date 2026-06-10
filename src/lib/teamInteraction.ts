/**
 * Team-interaction strategy for the Playwright crawler.
 *
 * Some sites display team member cards in the static HTML but hide contact
 * details (mailto, tel) behind a modal that only opens on click.  This module
 * clicks each detected card, waits for a modal/popup to appear, and extracts
 * the contact data before closing the modal and moving to the next card.
 *
 * Design goals:
 *  - Generic — works for any site, not just alcomet.bg
 *  - Safe — budget cap prevents runaway interaction time
 *  - Non-destructive — presses Escape and clicks close buttons; never submits forms
 */
import type { Page, Locator } from 'playwright';

export interface ClickedContact {
  name?:     string;
  position?: string;
  email?:    string;
  phone?:    string;
}

/**
 * CSS selectors for the team-member card element to click.
 * Ordered specific → broad so that the first match is the most reliable.
 * Exported so crawl.ts can do a fast pre-filter string check on static HTML
 * before spinning up the full Playwright interaction loop.
 */
export const TEAM_CARD_SELECTORS: readonly string[] = [
  '.staff-profile',
  '.team-member',
  '.employee-card',
  '.person-card',
  '.contact-card',
  '[class*="staff-profile"]',
  '[class*="team-member"]',
  '[class*="employee-card"]',
  '[class*="person-card"]',
  '[class*="contact-card"]',
];

// Modals / overlays that appear after clicking a card.
// Excludes common false-positive classes (cookie banners, backdrop overlays).
const MODAL_PARTS = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[class*="modal"]:not([class*="backdrop"])',
  '[class*="popup"]:not([class*="cookie"]):not([class*="consent"])',
  '[class*="lightbox"]',
];

// Used in page.evaluate / waitForFunction (browser context — no Playwright extensions).
const MODAL_SEL = MODAL_PARTS.join(', ');

// Used in page.locator() — Playwright's :visible filters to currently-visible elements
// so we always target the open modal and not hidden sibling dialogs.
const MODAL_SEL_VISIBLE = MODAL_PARTS.map((p) => `${p}:visible`).join(', ');

// Close-button selectors — tried before Escape key.
const CLOSE_SEL = [
  '[aria-label="Close"]',
  '[aria-label="close"]',
  '.btn-close',
  '.modal-close',
  '[class*="close-button"]',
  '[class*="close-btn"]',
  'button[class*="close"]',
  '[data-dismiss="modal"]',
].join(', ');

// Selectors for the person name visible on the card before clicking.
const CARD_NAME_SEL = 'h2, h3, h4, h5, [class*="name"], strong';

// Selectors for the role/position — probed inside the modal after clicking.
const ROLE_SEL = '[class*="role"], [class*="position"], [class*="title"], [class*="job"]';

export interface TeamInteractionOptions {
  /** Maximum cards to click per page (default 10). */
  maxCards?:   number;
  /** Ms to wait for a modal to appear after each click (default 1500). */
  modalWaitMs?: number;
  /** Ms to wait after closing a modal before clicking the next card (default 300). */
  closeWaitMs?: number;
  /** Total wall-clock budget across all cards on the page (default 10 000). */
  budgetMs?:   number;
}

/**
 * Clicks each team-member card on the page, waits for a contact modal, and
 * extracts email + phone from mailto/tel links inside it.
 *
 * Call this only from a Playwright requestHandler, after the page has fully
 * loaded.  Returns an empty array if no recognised card selector is found.
 */
export async function extractClickedContacts(
  page: Page,
  {
    maxCards    = 10,
    modalWaitMs = 1_500,
    closeWaitMs = 300,
    budgetMs    = 10_000,
  }: TeamInteractionOptions = {},
): Promise<ClickedContact[]> {
  const contacts: ClickedContact[] = [];
  const startTime = Date.now();

  // Find the first selector that matches a plausible number of cards.
  const cardSel = await detectCardSelector(page, maxCards);
  if (!cardSel) return contacts;

  const total = await page.locator(cardSel).count().catch(() => 0);
  const limit = Math.min(total, maxCards);

  for (let i = 0; i < limit; i++) {
    if (Date.now() - startTime > budgetMs) break;

    try {
      const contact = await interactWithCard(page, cardSel, i, {
        modalWaitMs,
        closeWaitMs,
      });
      if (contact) contacts.push(contact);
    } catch {
      // Dismiss any open modal and continue to the next card.
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);
    }
  }

  return contacts;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function detectCardSelector(page: Page, maxCards: number): Promise<string | null> {
  for (const sel of TEAM_CARD_SELECTORS) {
    try {
      const count = await page.locator(sel).count();
      // Accept selectors that match 1 – maxCards*3 elements.
      // Very high counts (e.g. 200) indicate an over-broad selector that
      // would match nav items, service blocks, etc. — skip those.
      if (count >= 1 && count <= maxCards * 3) return sel;
    } catch {
      continue;
    }
  }
  return null;
}

async function interactWithCard(
  page: Page,
  cardSel: string,
  index: number,
  { modalWaitMs, closeWaitMs }: { modalWaitMs: number; closeWaitMs: number },
): Promise<ClickedContact | null> {
  // Re-query each iteration — DOM may shift after modal open/close.
  const card = page.locator(cardSel).nth(index);

  // Extract the name visible on the card BEFORE clicking.
  const name = (
    await card.locator(CARD_NAME_SEL).first().textContent().catch(() => '') ?? ''
  ).trim();

  // Count currently visible modals to distinguish new from pre-existing.
  const modalsBefore = await countVisibleModals(page);

  await card.click({ timeout: 3_000 });

  // Wait for a new visible modal.
  const modalAppeared = await waitForNewModal(page, modalsBefore, modalWaitMs);

  // Determine extraction context: the currently visible modal if one appeared,
  // else the card itself.  MODAL_SEL_VISIBLE uses Playwright's :visible so we
  // land on the open dialog rather than a hidden sibling dialog in the DOM.
  const ctx: Locator = modalAppeared
    ? page.locator(MODAL_SEL_VISIBLE).first()
    : card;

  // Extract contact data via semantic href links — more reliable than text regex.
  const emails = await extractHrefLinks(ctx, 'mailto:');
  const phones = await extractHrefLinks(ctx, 'tel:');

  // Extract role/position from the context.
  const position = (
    await ctx.locator(ROLE_SEL).first().textContent().catch(() => '') ?? ''
  ).trim();

  // Close the modal before moving to the next card.
  // Pass ctx so the close button is searched within the visible modal,
  // not globally (which would pick the first close button in DOM order).
  if (modalAppeared) {
    await closeModal(page, ctx, closeWaitMs);
  }

  if (emails.length === 0 && phones.length === 0) return null;

  return {
    name:     name     || undefined,
    position: position || undefined,
    email:    emails[0],
    phone:    phones[0],
  };
}

/** Counts currently visible modals (display≠none, visibility≠hidden, opacity≠0). */
async function countVisibleModals(page: Page): Promise<number> {
  return page.evaluate((sel: string) =>
    Array.from(document.querySelectorAll(sel)).filter((el) => {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    }).length,
  MODAL_SEL).catch(() => 0);
}

/** Waits up to timeoutMs for the number of visible modals to exceed `before`. */
async function waitForNewModal(
  page: Page,
  before: number,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await page.waitForFunction(
      ({ sel, n }: { sel: string; n: number }) =>
        Array.from(document.querySelectorAll(sel)).filter((el) => {
          const s = window.getComputedStyle(el as Element);
          return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
        }).length > n,
      { sel: MODAL_SEL, n: before },
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts and normalises href values from links whose href starts with
 * `scheme` (e.g. "mailto:" or "tel:") within a Locator context.
 */
async function extractHrefLinks(ctx: Locator, scheme: 'mailto:' | 'tel:'): Promise<string[]> {
  return ctx
    .locator(`a[href^="${scheme}"]`)
    .evaluateAll((links: Element[], s: string) =>
      (links as HTMLAnchorElement[])
        .map((a) =>
          (a.getAttribute('href') ?? '')
            .replace(new RegExp(`^${s}`, 'i'), '')
            .split('?')[0]
            .replace(/\s/g, '')
            .trim(),
        )
        .filter((v) => v.length > 0),
    scheme)
    .catch(() => [] as string[]);
}

/** Tries the close button inside `modalCtx` first, then falls back to Escape. */
async function closeModal(page: Page, modalCtx: Locator, waitMs: number): Promise<void> {
  // Search for close button within the modal — avoids accidentally clicking the
  // close button of a different (hidden) modal that appears earlier in the DOM.
  await modalCtx.locator(CLOSE_SEL).first().click({ timeout: 1_000, force: true }).catch(() => {});
  await page.waitForTimeout(waitMs);
  // Escape works for native <dialog> elements and most JS modal frameworks.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(waitMs);
}
