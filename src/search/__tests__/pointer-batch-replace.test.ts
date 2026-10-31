import { describe, expect, test } from 'bun:test';
import { createDatabase } from '../../db/create.ts';
import { replaceDocumentPointers, replaceDocumentPointersBatch, type PointerInput } from '../pointer-index.ts';

const seed: PointerInput[] = [
  { documentId: 'old-1', content: 'Cloudflare Workers deploy notes', concepts: ['deploy'], timestamp: Date.UTC(2026, 9, 1) },
  { documentId: 'doc-a', content: 'stale text about Vercel', concepts: ['vercel'], timestamp: Date.UTC(2026, 8, 1) },
];
const batch: PointerInput[] = [
  { documentId: 'doc-a', content: 'Cloudflare Workers and SQLite FTS', concepts: ['deploy', 'sqlite'], timestamp: Date.UTC(2026, 9, 31) },
  { documentId: 'doc-b', content: 'SQLite pointer index notes', concepts: ['sqlite'], timestamp: Date.UTC(2026, 9, 31) },
  { documentId: 'doc-b', content: 'Bun runtime notes', concepts: ['bun'], timestamp: Date.UTC(2026, 9, 30) },
];

function pointerRows(apply: (sqlite: ReturnType<typeof createDatabase>['sqlite']) => void) {
  const { sqlite } = createDatabase(':memory:');
  for (const input of seed) replaceDocumentPointers(sqlite, input);
  apply(sqlite);
  const rows = sqlite.prepare('SELECT id, kind, key, doc_ids FROM oracle_pointer_index ORDER BY id').all();
  sqlite.close();
  return rows;
}

describe('replaceDocumentPointersBatch', () => {
  test('leaves the pointer table exactly as sequential replaceDocumentPointers calls do', () => {
    const sequential = pointerRows((sqlite) => { for (const input of batch) replaceDocumentPointers(sqlite, input); });
    const batched = pointerRows((sqlite) => replaceDocumentPointersBatch(sqlite, batch));

    expect(sequential.length).toBeGreaterThan(3);
    expect(batched).toEqual(sequential);
  });
});
