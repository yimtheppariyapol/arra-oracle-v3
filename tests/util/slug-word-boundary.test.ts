/**
 * Carry patch (fork, 2026-09-11; upstream discussion #3050): when the input window cuts a title
 * that contains non-ASCII text in the middle of a word, back off to the last word boundary.
 * ASCII-only windows are untouched, so tests/util/slug-ascii-identity.test.ts still holds.
 */
import { describe, expect, test } from 'bun:test';
import { slugifySnippet, slugifyTitle } from '../../src/util/slug.ts';

const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
/** The title normalized the same way, but never cut: the ruler must not share the knife. */
const normTitle = (v: string) =>
  v.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
const normSnippet = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-|-$/g, '');
/** Word boundaries of the lower-cased, punctuation-free title, as string offsets. */
function boundaries(slug: string): Set<number> {
  const out = new Set<number>([0]);
  let i = 0;
  for (const { segment } of seg.segment(slug.replace(/-/g, ' '))) { i += segment.length; out.add(i); }
  return out;
}

describe('slug window backs off to a word boundary for non-ASCII titles', () => {
  const thai = 'ไม้บรรทัดที่ถูกตัดด้วยมีดเล่มเดียวกัน มองไม่เห็นรอยตัด: เกณฑ์ที่เทียบ slug กับ title';

  test('a Thai title cut by the 50-char window ends on a whole word', () => {
    const slug = slugifyTitle(thai, 50);
    const full = normTitle(thai);
    expect(full.startsWith(slug)).toBe(true);
    expect(boundaries(full).has(slug.length)).toBe(true);
    expect(slug.endsWith('-มอ')).toBe(false);
  });

  test('a Thai run with no spaces is cut between segments, not inside one', () => {
    const run = 'ผู้ตรวจตอบได้แค่เท่าที่เราส่งของและคำถามไปให้และมันจะตอบเต็มปากเสมอทุกครั้ง';
    const slug = slugifyTitle(run, 50);
    expect(run.startsWith(slug)).toBe(true);
    expect(boundaries(run).has(slug.length)).toBe(true);
    expect(slug.length).toBeGreaterThan(0);
  });

  test('the snippet rule backs off the same way', () => {
    const slug = slugifySnippet(thai, 50);
    const full = normSnippet(thai);
    expect(full.startsWith(slug)).toBe(true);
    expect(boundaries(full).has(slug.length)).toBe(true);
  });

  test('an ASCII-only window is byte-identical to the plain window cut', () => {
    const en = 'A checker that returns empty when it breaks is a checker that does not exist at all';
    expect(slugifyTitle(en, 50)).toBe('a-checker-that-returns-empty-when-it-breaks-is-a-c');
  });

  test('a title that fits the window is unchanged', () => {
    expect(slugifyTitle('ทดสอบไทยล้วน', 50)).toBe('ทดสอบไทยล้วน');
  });
});
