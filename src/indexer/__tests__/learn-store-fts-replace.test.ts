/**
 * Guards: the learn-watcher store path (storeSqliteDocuments) replaces a document's FTS row by
 * rowid and leaves other documents untouched. It now deletes via the indexed shadow-table lookup
 * (fts-rowids.ts) instead of `WHERE id = ?`, which scanned the whole fts5 table per chunk.
 */
import { describe, expect, test } from 'bun:test';
import { createDatabase } from '../../db/create.ts';
import { storeSqliteDocuments } from '../learn-doc-source.ts';
import type { OracleDocument } from '../../types.ts';

const doc = (id: string, content: string): OracleDocument =>
  ({ id, type: 'learning', source_file: `ψ/learn/${id}.md`, content, concepts: [], created_at: 1, updated_at: 1 });

describe('storeSqliteDocuments FTS replace', () => {
  test('re-storing replaces only that document\'s FTS row', () => {
    const { sqlite } = createDatabase(':memory:');
    storeSqliteDocuments(sqlite, [doc('a', 'alpha old'), doc('b', 'beta')]);
    storeSqliteDocuments(sqlite, [doc('a', 'alpha new')]);
    const rows = sqlite.prepare('SELECT id, content FROM oracle_fts ORDER BY id').all();
    expect(rows).toEqual([{ id: 'a', content: 'alpha new' }, { id: 'b', content: 'beta' }]);
    const ptr = sqlite.prepare("SELECT count(*) AS n FROM oracle_pointer_index WHERE doc_ids LIKE '%\"a\"%'").get() as { n: number };
    expect(ptr.n).toBeGreaterThan(0);
    sqlite.close();
  });
});
