import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('duplicate jobs and identical chunks share one embedding and leave unique vector ids', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'shared text'); h.put('b', 'shared text'); h.enqueue('a', 'a', 'b');
    expect((await h.run()).processed).toBe(3);
    expect(h.calls).toEqual([['shared text']]);
    expect((await h.store.getStats()).count).toBe(2);
  } finally { await h.close(); }
});
