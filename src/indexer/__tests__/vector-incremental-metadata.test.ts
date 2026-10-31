import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('metadata updates reuse embeddings while updating the stored typed fields', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'same text', undefined, { project: 'house-a' }); h.enqueue('a'); await h.run(); h.calls.length = 0;
    h.put('a', 'same text', undefined, { project: 'house-b' }); h.enqueue('a'); await h.run();
    expect(h.calls).toHaveLength(0);
    expect((await h.store.getAllEmbeddings()).metadatas[0].house).toBe('house-b');
  } finally { await h.close(); }
});
