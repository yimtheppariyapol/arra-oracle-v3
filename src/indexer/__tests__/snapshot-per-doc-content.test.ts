import { describe, expect, test } from 'bun:test';
import { createDatabase } from '../../db/create.ts';
import { snapshotActiveIndexerDocs } from '../reindex-state.ts';

describe('snapshotActiveIndexerDocs', () => {
  test('gives each document only its own FTS content, not the whole table', () => {
    const { sqlite, db } = createDatabase(':memory:');
    const insertDoc = sqlite.prepare(
      `INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at, created_by)
       VALUES (?, 'learning', ?, '[]', 0, 0, 0, 'indexer')`,
    );
    const insertFts = sqlite.prepare(`INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, '')`);
    insertDoc.run('a', 'a.md');
    insertDoc.run('b', 'b.md');
    insertDoc.run('c', 'c.md');
    insertFts.run('a', 'alpha');
    insertFts.run('b', 'beta one');
    insertFts.run('b', 'beta two');

    const snap = snapshotActiveIndexerDocs(db);

    expect(snap.get('a')).toEqual({ sourceFile: 'a.md', content: 'alpha' });
    expect(snap.get('b')).toEqual({ sourceFile: 'b.md', content: 'beta one\nbeta two' });
    expect(snap.get('c')).toEqual({ sourceFile: 'c.md', content: null });
    sqlite.close();
  });
});
