import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';
import { readVectorDocuments } from '../vector-documents.ts';

test('FTS reads use indexed id lookup maintained across inserts edits and deletes', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'first'); h.put('b', 'unrelated'); h.put('a', 'edited');
    expect(readVectorDocuments(h.sqlite, ['a']).get('a')?.doc?.document).toBe('edited');
    const query = 'SELECT c1 AS content FROM oracle_fts_content WHERE c0 = ?';
    expect(h.sqlite.query(query).all('a')).toEqual([{ content: 'edited' }]);
    const plan = h.sqlite.query(`EXPLAIN QUERY PLAN ${query}`).all('a');
    expect(JSON.stringify(plan)).toContain('INDEX');
    expect(JSON.stringify(plan)).toContain('idx_fts_content_doc_id');
    h.sqlite.query('DELETE FROM oracle_fts WHERE id = ?').run('a');
    expect(h.sqlite.query('SELECT * FROM oracle_fts_content WHERE c0 = ?').all('a')).toEqual([]);
  } finally { await h.close(); }
});
