import { expect, test } from 'bun:test';
import { fixture, hits, integrity, metadata, rows, run } from './fixture.ts';

for (const operation of ['UPDATE', 'DELETE']) {
  test(`${operation} rollback restores metadata, FTS rows and MATCH results`, () => {
    const db = fixture();
    const snapshot = () => ({ metadata: metadata(db), rows: rows(db),
      content: hits(db, 'contenttoken'), old: hits(db, 'oldtoken'), changed: hits(db, 'changedtoken') });
    const before = snapshot();
    expect(() => db.transaction(() => {
      if (operation === 'UPDATE') {
        run(db, 'UPDATE oracle_documents SET concepts=? WHERE id=?', 'changedtoken', 'a');
        expect(hits(db, 'changedtoken')).toHaveLength(2);
      } else {
        run(db, 'DELETE FROM oracle_documents WHERE id=?', 'a');
        expect(hits(db, 'contenttoken')).toEqual([]);
      }
      expect(hits(db, 'oldtoken')).toEqual([]);
      throw new Error('injected rollback');
    })()).toThrow('injected rollback');
    expect(snapshot()).toEqual(before);
    integrity(db);
  });
}
