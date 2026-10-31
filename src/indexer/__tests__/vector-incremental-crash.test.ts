import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('crash after committed vector write before ack replays idempotently after reopening both databases', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'crash-safe chunk'); h.enqueue('a');
    await expect(h.run({ afterVectorCommit: () => { throw new Error('simulated process death'); } }))
      .rejects.toThrow('simulated process death');
    expect(h.sqlite.query('SELECT status FROM indexing_jobs').get()).toEqual({ status: 'claimed' });
    expect(h.sqlite.query('SELECT count(*) AS n FROM vector_index_manifest').get()).toEqual({ n: 0 });
    expect((await h.store.getStats()).count).toBe(1);
    await h.restart(); h.calls.length = 0;
    await h.run();
    expect(h.calls).toHaveLength(0);
    expect((await h.store.getAllEmbeddings()).ids).toEqual(['a']);
    expect(h.sqlite.query('SELECT status, attempts FROM indexing_jobs').get()).toEqual({ status: 'done', attempts: 2 });
  } finally { await h.close(); }
});
