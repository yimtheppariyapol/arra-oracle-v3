import { expect, test } from 'bun:test';
import { FallbackEmbeddings } from '../../vector/embeddings.ts';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('providers without immutable identity fail closed without burning jobs', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'identity'); h.enqueue('a');
    const fallback = new FallbackEmbeddings([h.embedder]);
    let stopped = false;
    setTimeout(() => { stopped = true; }, 100);
    await h.run({ incremental: { ...h.deps(), embedder: fallback, collection: 'chunks' }, isShuttingDown: () => stopped, onEvent: () => {}, pollIntervalMs: 1,
      onPause: () => { stopped = true; } });
    expect(h.sqlite.query('SELECT status, attempts FROM indexing_jobs').get()).toEqual({ status: 'pending', attempts: 0 });
    expect(h.calls).toHaveLength(0);
    expect((await h.store.getStats()).count).toBe(0);
  } finally { await h.close(); }
});
