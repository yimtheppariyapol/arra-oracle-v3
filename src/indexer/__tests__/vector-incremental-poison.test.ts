import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('a NaN chunk fails only its job while good chunks commit', async () => {
  const h = await incrementalHarness();
  try {
    h.put('good', 'good'); h.put('bad', 'POISON'); h.enqueue('good', 'bad');
    const original = h.embedder.embed.bind(h.embedder);
    h.embedder.embed = async (texts, type) => (await original(texts, type))
      .map((v, i) => texts[i] === 'POISON' ? v.map(() => NaN) : v);
    await h.run();
    expect((await h.store.getAllEmbeddings()).ids).toEqual(['good']);
    expect(h.sqlite.query('SELECT doc_id, status FROM indexing_jobs ORDER BY doc_id').all())
      .toEqual([{ doc_id: 'bad', status: 'error' }, { doc_id: 'good', status: 'done' }]);
  } finally { await h.close(); }
});
