import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('editing one document embeds only its changed chunk and preserves other chunks', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a__chunk_0', 'stable first chunk'); h.put('a__chunk_1', 'old second chunk');
    h.put('b', 'unrelated document'); h.enqueue('a__chunk_0', 'a__chunk_1', 'b'); await h.run();
    h.calls.length = 0;
    h.put('a__chunk_1', 'edited second chunk'); h.enqueue('a__chunk_0', 'a__chunk_1', 'b'); await h.run();
    expect(h.calls).toEqual([['edited second chunk']]);
    expect((await h.store.getStats()).count).toBe(3);
    expect((await h.store.getAllEmbeddings()).documents).toContain('edited second chunk');
  } finally { await h.close(); }
});
