import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { deleteFtsById, ftsContentById, ftsContentByIds, ftsJoin, ftsSource, hasFtsContentIndex } from '../fts-lookup.ts';

const opened: Database[] = [];
function fixture(indexed: boolean): Database {
  const db = new Database(':memory:');
  opened.push(db);
  db.exec(`
    CREATE TABLE docs (id TEXT PRIMARY KEY);
    CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts);
    INSERT INTO docs VALUES ('a'), ('b'), ('missing');
    INSERT INTO oracle_fts VALUES ('a', 'uniqueword first chunk', 'alpha');
    INSERT INTO oracle_fts VALUES ('b', 'retainedword', 'beta');
    INSERT INTO oracle_fts VALUES ('a', 'uniqueword second chunk', 'gamma');
  `);
  if (indexed) db.exec('CREATE INDEX idx_fts_content_doc_id ON oracle_fts_content(c0)');
  return db;
}
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

function joined(db: Database, left = false) {
  return db.query(`SELECT d.id, f.content FROM docs d ${left ? 'LEFT ' : ''}JOIN ${ftsJoin(db)}
    ORDER BY d.id, f.rowid`).all();
}
function aggregates(db: Database) {
  return db.query(`SELECT d.id, GROUP_CONCAT(f.content, char(10)) AS content
    FROM docs d LEFT JOIN ${ftsJoin(db)} GROUP BY d.id ORDER BY d.id`).all();
}

describe('FTS content lookup', () => {
  test('indexed and fallback paths preserve chunks, aggregates, first row and LEFT nulls', () => {
    const indexed = fixture(true), fallback = fixture(false);
    expect(hasFtsContentIndex(indexed)).toBe(true);
    expect(hasFtsContentIndex(fallback)).toBe(false);
    expect(joined(indexed)).toEqual(joined(fallback));
    expect(joined(indexed)).toHaveLength(3);
    expect(joined(indexed, true)).toEqual(joined(fallback, true));
    expect(joined(indexed, true)).toContainEqual({ id: 'missing', content: null });
    expect(aggregates(indexed)).toEqual(aggregates(fallback));
    expect(aggregates(indexed)[0]).toEqual({ id: 'a', content: 'uniqueword first chunk\nuniqueword second chunk' });
    for (const db of [indexed, fallback]) {
      expect(ftsContentById(db, 'a')).toEqual({ id: 'a', content: 'uniqueword first chunk', concepts: 'alpha' });
      expect(ftsContentById(db, 'missing')).toBeNull();
      expect(ftsContentByIds(db, [])).toEqual([]);
      expect(ftsContentByIds(db, ['a', 'a', 'missing'])).toHaveLength(2);
    }
    expect(ftsContentByIds(indexed, ['b', 'a'])).toEqual(ftsContentByIds(fallback, ['b', 'a']));
  });

  for (const indexed of [true, false]) {
    test(`delete all chunk rows through FTS5 (${indexed ? 'indexed' : 'fallback'})`, () => {
      const db = fixture(indexed);
      deleteFtsById(db, 'a');
      expect(ftsContentByIds(db, ['a'])).toEqual([]);
      expect(db.query("SELECT id FROM oracle_fts WHERE oracle_fts MATCH 'uniqueword'").all()).toEqual([]);
      expect(db.query("SELECT id FROM oracle_fts WHERE oracle_fts MATCH 'retainedword'").all()).toEqual([{ id: 'b' }]);
      deleteFtsById(db, ['b', 'b', 'missing']);
      deleteFtsById(db, []);
      expect(db.query('SELECT count(*) AS n FROM oracle_fts').get()).toEqual({ n: 0 });
      db.exec("INSERT INTO oracle_fts(oracle_fts) VALUES ('integrity-check')");
    });
  }

  test('delete participates in an outer transaction rollback', () => {
    const db = fixture(true);
    expect(() => db.transaction(() => {
      deleteFtsById(db, 'a');
      throw new Error('rollback');
    })()).toThrow('rollback');
    expect(ftsContentByIds(db, ['a'])).toHaveLength(2);
    expect(db.query("SELECT id FROM oracle_fts WHERE oracle_fts MATCH 'uniqueword'").all()).toHaveLength(2);
  });

  test('indexed joins and subqueries use c0 index without virtual table scans', () => {
    const db = fixture(true);
    for (const sql of [
      `SELECT f.content FROM docs d LEFT JOIN ${ftsJoin(db)} WHERE d.id = ?`,
      `SELECT content FROM ${ftsSource(db)} WHERE id = ?`,
      `SELECT content FROM ${ftsSource(db)} WHERE id IN (?)`,
    ]) {
      const plan = JSON.stringify(db.query(`EXPLAIN QUERY PLAN ${sql}`).all('a'));
      expect(plan).toContain('idx_fts_content_doc_id');
      expect(plan).not.toContain('VIRTUAL TABLE');
    }
  });

  test('index detection caches per connection and refreshes after schema changes', () => {
    const db = fixture(false), other = fixture(true);
    expect(hasFtsContentIndex(db)).toBe(false);
    expect(hasFtsContentIndex(other)).toBe(true);
    db.exec('CREATE INDEX idx_fts_content_doc_id ON oracle_fts_content(c0)');
    expect(hasFtsContentIndex(db)).toBe(true);
    db.exec('DROP INDEX idx_fts_content_doc_id');
    expect(hasFtsContentIndex(db)).toBe(false);
    expect(hasFtsContentIndex(other)).toBe(true);
  });

  test('batch reads span parameter batches without dropping chunks or repeating ids', () => {
    for (const indexed of [true, false]) {
      const db = fixture(indexed);
      const ids = Array.from({ length: 1001 }, (_, i) => `doc-${i}`);
      const insert = db.prepare('INSERT INTO oracle_fts VALUES (?, ?, ?)');
      for (const id of ids) insert.run(id, id, '');
      expect(ftsContentByIds(db, [...ids, 'a', ids[0]])).toHaveLength(1003);
      deleteFtsById(db, ids);
      expect(ftsContentByIds(db, ids)).toEqual([]);
      expect(ftsContentByIds(db, ['a'])).toHaveLength(2);
    }
  });
});
