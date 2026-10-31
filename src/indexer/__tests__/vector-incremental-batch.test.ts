import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('default batch size is 32 jobs; each batch sends only unique cache misses in one call', async () => {
  const h = await incrementalHarness();
  try {
    for (let i = 0; i < 70; i++) { h.put(`d${i}`, `text-${i}`); h.enqueue(`d${i}`); }
    const stats = await h.run();
    expect(stats.processed).toBe(70); expect(h.calls.map((batch) => batch.length)).toEqual([32, 32, 6]);
    expect((await h.store.getStats()).count).toBe(70);
  } finally { await h.close(); }
});
