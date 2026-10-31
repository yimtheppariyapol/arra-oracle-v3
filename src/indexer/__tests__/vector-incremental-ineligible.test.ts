import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('eligibility is checked at claim time; done records its reason with zero embeddings', async () => {
  const h = await incrementalHarness();
  try {
    h.put('noisy', 'not vector material', 'ψ/inbox/results/noise.md'); h.enqueue('noisy');
    const stats = await h.run();
    expect(stats.processed).toBe(1); expect(h.calls).toHaveLength(0);
    expect(h.sqlite.query('SELECT status, error FROM indexing_jobs').all())
      .toEqual([{ status: 'done', error: 'ineligible' }]);
    expect((await h.store.getStats()).count).toBe(0);
  } finally { await h.close(); }
});
