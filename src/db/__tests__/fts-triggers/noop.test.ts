import { expect, test } from 'bun:test';
import { all, fixture, hits, integrity, oldTriggerSql, rows, run } from './fixture.ts';
import type { Database } from 'bun:sqlite';

function changes(db: Database, sql: string, ...args: (string | null)[]) {
  const total = () => all<{ n: number }>(db, 'SELECT total_changes() AS n')[0].n;
  const before = total();
  run(db, sql, ...args);
  return total() - before;
}

test('equal concepts updates change only the parent; 0032 is a negative control', () => {
  const old = fixture(oldTriggerSql);
  expect(changes(old, 'UPDATE oracle_documents SET concepts=concepts WHERE id=?', 'a')).toBeGreaterThan(1);
  const db = fixture();
  const before = rows(db);
  expect(changes(db, 'UPDATE oracle_documents SET concepts=concepts WHERE id=?', 'a')).toBe(1);
  expect(rows(db)).toEqual(before);
  integrity(db);
});

test('NULL equality skips FTS, while NULL to text and text to NULL update MATCH entries', () => {
  const db = fixture();
  run(db, 'UPDATE oracle_documents SET concepts=NULL WHERE id=?', 'a');
  expect(hits(db, 'oldtoken')).toEqual([]);
  expect(rows(db).filter((r) => r.id === 'a').map((r) => r.concepts)).toEqual([null, null]);
  expect(changes(db, 'UPDATE oracle_documents SET concepts=concepts WHERE id=?', 'a')).toBe(1);
  expect(changes(db, 'UPDATE oracle_documents SET concepts=? WHERE id=?', 'nonnulltoken', 'a')).toBeGreaterThan(1);
  expect(hits(db, 'nonnulltoken')).toEqual(hits(db, 'contenttoken'));
  run(db, 'UPDATE oracle_documents SET concepts=NULL WHERE id=?', 'a');
  expect(hits(db, 'nonnulltoken')).toEqual([]);
  expect(hits(db, 'contenttoken')).toHaveLength(2);
  integrity(db);
});

test('no-op does not repair divergent FTS concepts; changed JSON text still synchronizes', () => {
  const db = fixture();
  run(db, 'UPDATE oracle_fts SET concepts=? WHERE rowid IN (SELECT id FROM oracle_fts_content WHERE c0=?)', 'drifttoken', 'a');
  const divergent = rows(db);
  expect(changes(db, 'UPDATE oracle_documents SET concepts=concepts WHERE id=?', 'a')).toBe(1);
  expect(rows(db)).toEqual(divergent);
  expect(hits(db, 'drifttoken')).toHaveLength(2);
  run(db, 'UPDATE oracle_documents SET concepts=? WHERE id=?', '[ "oldtoken" ]', 'a');
  expect(hits(db, 'drifttoken')).toEqual([]);
  expect(hits(db, 'oldtoken')).toHaveLength(2);
  integrity(db);
});
