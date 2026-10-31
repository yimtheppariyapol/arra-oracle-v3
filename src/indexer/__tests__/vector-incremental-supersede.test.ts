import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { oracleDocuments } from '../../db/schema.ts';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('superseded chunks get tombstones even without a producer-enqueued job', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'old knowledge'); h.enqueue('a'); await h.run(); h.calls.length = 0;
    h.db.update(oracleDocuments).set({ supersededBy: 'successor' }).where(eq(oracleDocuments.id, 'a')).run();
    await h.run();
    expect(h.calls).toHaveLength(0); expect((await h.store.getStats()).count).toBe(0);
    expect(h.sqlite.query('SELECT error FROM indexing_jobs WHERE error IS NOT NULL').get()).toEqual({ error: 'superseded' });
  } finally { await h.close(); }
});
