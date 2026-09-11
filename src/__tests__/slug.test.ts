/**
 * Unit tests for slugifyPattern.
 */

import { describe, it, expect } from 'bun:test';
import { slugifyPattern } from '../slug.ts';

// ============================================================================
// slugifyPattern
// ============================================================================

describe('slugifyPattern', () => {
  it('should slugify a Latin pattern', () => {
    expect(slugifyPattern('Ascii Leading Title')).toBe('ascii-leading-title');
  });

  it('should keep non-Latin scripts instead of dropping them', () => {
    // Previously collapsed to '' because the character class was [a-z0-9\s-].
    expect(slugifyPattern('ทดสอบไทยล้วน')).toBe('ทดสอบไทยล้วน');
    expect(slugifyPattern('日本語のタイトル')).toBe('日本語のタイトル');
  });

  it('should keep the non-Latin words in a mixed pattern', () => {
    expect(slugifyPattern('ทดสอบ mixed title')).toBe('ทดสอบ-mixed-title');
  });

  it('should give distinct slugs to distinct non-Latin patterns', () => {
    // The collision this guards: both used to slugify to '', so the second write
    // hit `UNIQUE constraint failed: oracle_documents.id`.
    expect(slugifyPattern('บทเรียนแรก')).not.toBe(slugifyPattern('บทเรียนที่สอง'));
  });

  it('should never return an empty slug', () => {
    expect(slugifyPattern('...')).not.toBe('');
    expect(slugifyPattern('🧦🧦')).not.toBe('');
    expect(slugifyPattern('   ')).not.toBe('');
  });

  it('should drop punctuation but keep letters and numbers', () => {
    expect(slugifyPattern('v2: the "fix" (final)!')).toBe('v2-the-fix-final');
  });

  // Cut at a word boundary, budgeted in bytes. The old rule was pattern.substring(0, 50): it cut
  // mid-word in 440 of 520 truncated learnings (2026-09-09), e.g. "...มองไม่เห็นรอยตัด" -> "...มองไม่เห็นรอ".
  const enc = new TextEncoder();
  const clean = (p: string) =>
    p.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  it('should cut a long Latin pattern at a word boundary', () => {
    const p = 'A checker that returns empty when it breaks is a checker that does not exist at all';
    const slug = slugifyPattern(p);
    expect(clean(p).startsWith(slug + '-')).toBe(true);
  });

  it('should cut a long Thai pattern at a space, not inside a word', () => {
    const p = 'ไม้บรรทัดที่ถูกตัดด้วยมีดเล่มเดียวกัน มองไม่เห็นรอยตัด: เกณฑ์ที่เทียบ slug กับ title';
    expect(slugifyPattern(p)).toBe('ไม้บรรทัดที่ถูกตัดด้วยมีดเล่มเดียวกัน-มองไม่เห็นรอยตัด');
  });

  it('should cut a Thai run with no spaces at a segmenter word boundary', () => {
    const p = 'ผู้ตรวจตอบได้แค่เท่าที่เราส่งของและคำถามไปให้และมันจะตอบเต็มปากเสมอทุกครั้งที่ถาม';
    const slug = slugifyPattern(p);
    const seg = new Intl.Segmenter('th', { granularity: 'word' });
    const ends = new Set<number>(); let i = 0;
    for (const s of seg.segment(p)) { i += s.segment.length; ends.add(i); }
    expect(p.startsWith(slug)).toBe(true);
    expect(ends.has(slug.length)).toBe(true);
    expect(slug.length).toBeLessThan(p.length);
  });

  it('should keep a slug within 180 bytes and 60 characters', () => {
    const th = 'ทดสอบ '.repeat(40);
    const en = 'word '.repeat(40);
    for (const p of [th, en]) {
      const slug = slugifyPattern(p);
      expect(enc.encode(slug).length).toBeLessThanOrEqual(180);
      expect([...slug].length).toBeLessThanOrEqual(60);
      expect(slug.endsWith('-')).toBe(false);
    }
  });

  it('should leave a short pattern whole', () => {
    expect(slugifyPattern('ทดสอบไทยล้วน')).toBe('ทดสอบไทยล้วน');
  });
});
