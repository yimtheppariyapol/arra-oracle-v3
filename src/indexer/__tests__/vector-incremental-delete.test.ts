import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { oracleDocuments } from '../../db/schema.ts';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('deletion discovers a durable tombstone and removes the vector and manifest without embeddings', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'delete this'); h.enqueue('a'); await h.run(); h.calls.length = 0;
    h.db.delete(oracleDocuments).where(eq(oracleDocuments.id, 'a')).run();
    await h.run();
    expect(h.calls).toHaveLength(0); expect((await h.store.getStats()).count).toBe(0);
    expect(h.sqlite.query('SELECT count(*) AS n FROM vector_index_manifest').get()).toEqual({ n: 0 });
    expect(h.sqlite.query('SELECT status, error FROM indexing_jobs WHERE error IS NOT NULL').all())
      .toEqual([{ status: 'done', error: 'deleted' }]);
  } finally { await h.close(); }
});
