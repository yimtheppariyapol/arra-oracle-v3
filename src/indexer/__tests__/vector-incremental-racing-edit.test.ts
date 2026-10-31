import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('an edit during the vector write replays the claim before acknowledging the latest text', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'initial'); h.enqueue('a');
    let writes = 0;
    const stats = await h.run({ afterVectorCommit: () => {
      if (++writes === 1) h.put('a', 'edited while claimed');
    } });
    expect(stats.processed).toBe(1); expect(writes).toBe(2);
    expect((await h.store.getAllEmbeddings()).documents).toEqual(['edited while claimed']);
    expect(h.sqlite.query('SELECT status, attempts FROM indexing_jobs').get()).toEqual({ status: 'done', attempts: 2 });
  } finally { await h.close(); }
});
