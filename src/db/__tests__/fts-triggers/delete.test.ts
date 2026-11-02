import { expect, test } from 'bun:test';
import { fixture, hits, integrity, metadata, rows, run } from './fixture.ts';

test('parent delete removes every matching chunk and MATCH hit, preserving unrelated content', () => {
  const db = fixture();
  const unrelated = rows(db).filter((r) => r.id !== 'a');
  run(db, 'DELETE FROM oracle_documents WHERE id=?', 'a');
  expect(rows(db)).toEqual(unrelated);
  expect(hits(db, 'contenttoken')).toEqual([]);
  expect(hits(db, 'oldtoken')).toEqual([]);
  expect(hits(db, 'retainedword')).toHaveLength(1);
  expect(metadata(db).map((r) => r.id)).toEqual(['!?/::', 'b', 'missing']);
  integrity(db);
});

test('batched parent delete handles punctuation-only ids and metadata without FTS', () => {
  const db = fixture();
  const retained = rows(db).filter((r) => r.id === 'b');
  run(db, 'DELETE FROM oracle_documents WHERE id IN (?, ?, ?)', 'a', '!?/::', 'missing');
  expect(rows(db)).toEqual(retained);
  expect(metadata(db)).toEqual([{ id: 'b', concepts: '["retainedconcept"]' }]);
  for (const token of ['contenttoken', 'oldtoken', 'punctword', 'punctconcept']) {
    expect(hits(db, token)).toEqual([]);
  }
  expect(hits(db, 'retainedword')).toHaveLength(1);
  integrity(db);
});
