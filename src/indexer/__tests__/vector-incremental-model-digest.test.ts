import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('model digest changes invalidate unchanged text in both manifest and cache', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'same text'); h.enqueue('a'); await h.run(); h.calls.length = 0;
    h.setDigest('sha256:fake-v2'); h.enqueue('a'); await h.run();
    expect(h.calls).toEqual([['same text']]);
    expect((await h.store.getAllEmbeddings()).metadatas[0].model_digest).toBe('sha256:fake-v2');
  } finally { await h.close(); }
});
