import { expect, test } from 'bun:test';
import { fixture, hits, integrity, rows, run } from './fixture.ts';

test('concepts update maintains every chunk, rowid and content token through FTS5', () => {
  const db = fixture();
  const before = rows(db);
  run(db, 'UPDATE oracle_documents SET concepts=? WHERE id=?', '["newtoken"]', 'a');
  expect(rows(db)).toEqual(before.map((r) => r.id === 'a' ? { ...r, concepts: '["newtoken"]' } : r));
  expect(hits(db, 'oldtoken')).toEqual([]);
  expect(hits(db, 'newtoken')).toEqual(hits(db, 'contenttoken'));
  expect(hits(db, 'contenttoken').map((r) => r.rowid)).toEqual(before.filter((r) => r.id === 'a').map((r) => r.rowid));
  expect(hits(db, 'retainedword')).toHaveLength(1);
  integrity(db);
});

test('concepts sync handles punctuation-only ids and metadata without matching chunks', () => {
  const db = fixture();
  const before = rows(db);
  run(db, 'UPDATE oracle_documents SET concepts=? WHERE id IN (?, ?)', '["punctnew"]', '!?/::', 'missing');
  expect(rows(db)).toEqual(before.map((r) => r.id === '!?/::' ? { ...r, concepts: '["punctnew"]' } : r));
  expect(hits(db, 'punctconcept')).toEqual([]);
  expect(hits(db, 'punctnew')).toEqual(hits(db, 'punctword'));
  integrity(db);
});
