import { expect, test } from 'bun:test';
import { indexingJobs } from '../../db/schema.ts';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('failed vector writes cannot ack jobs; retry reuses the cached batch', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'write must commit'); h.enqueue('a');
    const write = h.store.upsertVectors.bind(h.store);
    h.store.upsertVectors = async () => { throw new Error('injected write failure'); };
    expect((await h.run()).errors).toBe(1);
    expect(h.sqlite.query('SELECT status FROM indexing_jobs').get()).toEqual({ status: 'error' });
    expect(h.sqlite.query('SELECT count(*) AS n FROM vector_index_manifest').get()).toEqual({ n: 0 });
    h.store.upsertVectors = write; h.calls.length = 0;
    h.db.update(indexingJobs).set({ finishedAt: 0 }).run(); await h.run();
    expect(h.calls).toHaveLength(0);
    expect(h.sqlite.query('SELECT status FROM indexing_jobs').get()).toEqual({ status: 'done' });
    expect((await h.store.getStats()).count).toBe(1);
  } finally { await h.close(); }
});
