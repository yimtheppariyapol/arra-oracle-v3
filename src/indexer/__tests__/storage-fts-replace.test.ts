import { describe, expect, test } from 'bun:test';
import { createDatabase } from '../../db/create.ts';
import { storeDocuments } from '../storage.ts';
import type { OracleDocument } from '../../types.ts';

function doc(id: string, content: string): OracleDocument {
  return { id, type: 'learning', source_file: `${id}.md`, content, concepts: [], created_at: 1, updated_at: 1 };
}

describe('storeDocuments FTS replace', () => {
  test('re-storing a document replaces its FTS row and leaves other documents alone', async () => {
    const { sqlite, db } = createDatabase(':memory:');
    await storeDocuments(sqlite, db, null, null, [doc('a', 'alpha old'), doc('b', 'beta')]);
    await storeDocuments(sqlite, db, null, null, [doc('a', 'alpha new')]);
    // Same id twice in one batch must still leave one row.
    await storeDocuments(sqlite, db, null, null, [doc('c', 'gamma one'), doc('c', 'gamma two')]);

    const rows = sqlite.prepare('SELECT id, content FROM oracle_fts ORDER BY id').all();
    expect(rows).toEqual([
      { id: 'a', content: 'alpha new' },
      { id: 'b', content: 'beta' },
      { id: 'c', content: 'gamma two' },
    ]);
    sqlite.close();
  });
});
