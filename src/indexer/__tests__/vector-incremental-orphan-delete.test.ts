import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { oracleDocuments } from '../../db/schema.ts';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('deleting a document after a pre-ack crash removes the unmanifested vector on replay', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'orphan candidate'); h.enqueue('a');
    await expect(h.run({ afterVectorCommit: () => { throw new Error('crash'); } })).rejects.toThrow('crash');
    h.db.delete(oracleDocuments).where(eq(oracleDocuments.id, 'a')).run();
    await h.restart(); h.calls.length = 0; await h.run();
    expect(h.calls).toHaveLength(0); expect((await h.store.getStats()).count).toBe(0);
    expect(h.sqlite.query('SELECT status, error FROM indexing_jobs').get()).toEqual({ status: 'done', error: 'deleted' });
  } finally { await h.close(); }
});
