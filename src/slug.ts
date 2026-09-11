/**
 * Filename slug derivation for vault documents (learnings, handoffs).
 *
 * Kept in one place because the same six-line chain was copy-pasted across the MCP tools and
 * the HTTP routes, so a bug in it had to be fixed four times to actually be fixed.
 */

/**
 * Build a filename slug from a free-text title.
 *
 * Keeps any Unicode letter, number, or combining mark — not just `[a-z0-9]`. The previous rule
 * stripped every non-ASCII character, so a title written entirely in a non-Latin script (Thai,
 * Japanese, Cyrillic, ...) collapsed to an empty slug. The first such document of the day then
 * took the id `<prefix>_<date>_` and every later one that day was rejected with
 * `UNIQUE constraint failed: oracle_documents.id`. A single Latin letter or digit anywhere in
 * the title masked the bug, which is why it went unnoticed.
 *
 * `\p{M}` matters as much as `\p{L}`: without it, Thai vowel signs and tone marks are stripped,
 * so "ทดสอบไทยล้วน" silently becomes "ทดสอบไทยลวน" — a different word.
 *
 * Falls back to a short content hash when a title has no letters or numbers at all (punctuation
 * or emoji only), so the slug is never empty and the id stays unique.
 */
/** Byte budget for a slug. Linux NAME_MAX is 255 bytes and Thai is 3 bytes per character, so a
 * character cap that looks short on macOS can still fail checkout on Linux. 180 bytes + the date
 * prefix + a collision suffix stays well under 255. Same number as the rrr skill's slug rule. */
const SLUG_MAX_BYTES = 180;
/** Character cap so Latin slugs (1 byte per character) do not grow to 180 characters. */
const SLUG_MAX_CHARS = 60;

const utf8 = new TextEncoder();
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

function fits(s: string): boolean {
  return [...s].length <= SLUG_MAX_CHARS && utf8.encode(s).length <= SLUG_MAX_BYTES;
}

/**
 * Longest leading run of `words` (already cleaned, joined by '-') that fits the budget.
 * Cuts at a word boundary, never inside a word: the previous rule was `substring(0, 50)` on the
 * raw pattern, which cut mid-word in 440 of 520 truncated learnings (measured 2026-09-09) — for
 * example "...มองไม่เห็นรอยตัด" became "...มองไม่เห็นรอ".
 *
 * Whitespace boundaries come first. Only when the first word alone is over budget (a Thai run
 * with no spaces) does it fall back to Intl.Segmenter word boundaries inside that word.
 */
function takeWithinBudget(words: string[]): string {
  let out = '';
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (fits(next)) { out = next; continue; }
    if (out) return out;
    // First word is over budget on its own: cut it at segmenter word boundaries.
    let part = '';
    for (const { segment } of segmenter.segment(w)) {
      if (!fits(part + segment)) break;
      part += segment;
    }
    return part;
  }
  return out;
}

export function slugifyPattern(pattern: string): string {
  const words = pattern
    .substring(0, 1000) // bound the work; a slug never needs more than the opening of a pattern
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, '')
    .split(/[\s-]+/)
    .filter(Boolean);
  const slug = takeWithinBudget(words);
  if (slug) return slug;
  let h = 0;
  for (const ch of pattern) h = (Math.imul(h, 31) + ch.codePointAt(0)!) | 0;
  return `x${(h >>> 0).toString(36)}`;
}
