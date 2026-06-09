// Phone number extraction for Bulgarian and international formats.
// Follows the same module structure as emailExtraction.ts.
//
// Root cause of previous bug:
//   Old regex:  0\d{1,4}[\s\-.](?:\d[\s\-.]?){5,11}
//     - Only ONE separator character allowed after the prefix ([\s\.] = single char)
//     - '/' was missing from separator class
//   Result: "0893 / 35 41 42" failed because ' / ' is three chars, not one,
//           and '0877/86-62-18' failed because '/' is not in [\s\-.]
//
// Fix:
//   - Added '/' and '()' to every separator class
//   - Changed the single separator after the prefix to `*` (zero-or-more)
//   - This allows "0893 / 35 41 42" (space+slash+space = 3 separator chars)
//     and "0877/86-62-18" (slash as separator)

// Separator class intentionally excludes \n — phone numbers are single-line.
// Excluding newlines prevents the regex from bridging table rows / page sections
// (e.g. "0875 300 000\n   14" must NOT yield "087530000014").
export const PHONE_RE =
  /(?<!\d)((?:\+\d{1,3}|00\d{1,3})[ \t\-./()]*(?: *\d[ \t\-./()]*){6,14}|0\d{1,4}[ \t\-./()]*(?:\d[ \t\-./()]*){5,11})(?![\d\-])/g;

// Strip all formatting characters to produce a digit-only (plus optional leading +)
// string used as the base for deduplication keys.
export function normalizePhone(p: string): string {
  return p.replace(/[\s\-./()]/g, '');
}

// Convert a formatting-stripped phone string to a canonical international form
// so that local and international representations of the same number share one
// dedup key.  Examples (Bulgarian country code 359):
//   "0875300000"      → "+359875300000"
//   "00359875300000"  → "+359875300000"
//   "+359875300000"   → "+359875300000"  (already canonical)
//   "+44207946xxxx"   → "+44207946xxxx"  (non-BG international, unchanged)
// Only local 0-prefix numbers (not starting with 00) are assumed Bulgarian.
export function canonicalizePhone(stripped: string, countryCode = '359'): string {
  if (stripped.startsWith('+')) return stripped;
  if (stripped.startsWith(`00${countryCode}`)) return `+${stripped.slice(2)}`;
  if (stripped.startsWith('0') && !stripped.startsWith('00')) {
    return `+${countryCode}${stripped.slice(1)}`;
  }
  return stripped;
}

export function extractPhones(text: string): string[] {
  PHONE_RE.lastIndex = 0;
  const raw = text.match(PHONE_RE) ?? [];

  // Map canonical form → best display string seen so far.
  // International (+359…) form is preferred over local (0…) form.
  const canonicalMap = new Map<string, string>();

  for (const p of raw) {
    // Trim any trailing separators the greedy `[\s\-./()]*` may have consumed
    // before (?![\d\-]) succeeded (e.g. "0877-86-62-18-" → "0877-86-62-18")
    const display = p.replace(/[\s\-./()]+$/, '').trim();
    if (!display) continue;

    const digits = display.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) continue;

    // Reject standalone date patterns: dd.mm.yyyy or dd/mm/yyyy or dd-mm-yyyy
    if (/^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}$/.test(display)) continue;

    // Reject strings that contain an embedded date with a 4-digit year.
    // Catches document-reference+date patterns such as "01/ 14.01.2021" where a
    // short reference prefix ("01/") followed by a date ("14.01.2021") satisfies
    // PHONE_RE.  The year anchor (19|20)\d{2} avoids false-positives on digit
    // sequences that happen to contain "19" or "20" (e.g. "0899-20-20-30").
    if (/\d{1,2}[./\-]\d{1,2}[./\-](19|20)\d{2}/.test(display)) continue;

    // Reject decimal numbers (coordinates, prices): 226.5000
    if (/^\d+\.\d+$/.test(display)) continue;

    // Reject anything whose raw digit string starts with a year (19xx, 20xx)
    if (/^(19|20)\d{2}/.test(digits)) continue;

    // Reject IPv4 addresses
    if (/^\d+\.\d+\.\d+\.\d+$/.test(display)) continue;

    // Reject "00X-D.DDD-NNNN" item/version codes: a single digit followed by a dot
    // then exactly 3 digits (European thousands separator format, e.g. 2.077) never
    // appears in real international phone numbers.
    if (/^00\d/.test(display) && /\d\.\d{3}(?:\D|$)/.test(display)) continue;

    const norm = normalizePhone(display);
    // Must start with '+' (international) or '0' (local / 00-international)
    if (!norm.startsWith('+') && !norm.startsWith('0')) continue;

    const canonical = canonicalizePhone(norm);

    if (!canonicalMap.has(canonical)) {
      canonicalMap.set(canonical, display);
    } else if (norm.startsWith('+') && !normalizePhone(canonicalMap.get(canonical)!).startsWith('+')) {
      // International form is more complete — replace a previously-stored local form.
      canonicalMap.set(canonical, display);
    }
  }

  return [...canonicalMap.values()];
}
