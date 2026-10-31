import { expect, test } from 'bun:test';
import { writeIncrementalVectors } from '../incremental-vectors.ts';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('unchanged reruns and forced full rebuilds use zero embedding calls across restarts', async () => {
  const h = await incrementalHarness();
  try {
    h.put('doc__chunk_0', 'unchanged text'); h.enqueue('doc__chunk_0');
    await h.run();
    expect(h.calls).toEqual([['unchanged text']]);
    await h.restart(); h.calls.length = 0;
    h.enqueue('doc__chunk_0'); await h.run();
    expect(h.calls).toHaveLength(0);
    const rebuilt = await writeIncrementalVectors(h.deps(), ['doc__chunk_0'], true);
    rebuilt.commit();
    expect(rebuilt.embedded).toBe(0);
    expect(h.calls).toHaveLength(0);
    expect((await h.store.getStats()).count).toBe(1);
  } finally { await h.close(); }
});
