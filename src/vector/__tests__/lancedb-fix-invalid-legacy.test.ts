import { expect, test } from 'bun:test';
import { connect } from '@lancedb/lancedb';
import { prefilterHarness, queryVector } from './lancedb-prefilter-harness.ts';

test('malformed legacy metadata cannot make a vector table unopenable', async () => {
  const h = await prefilterHarness();
  try {
    await h.store.deleteCollection();
    await (await connect(h.directory)).createTable('filtered', [
      { id: 'a', text: 'a', vector: queryVector, metadata: '{invalid' },
      { id: 'b', text: 'b', vector: queryVector, metadata: JSON.stringify({ doc_date: 'invalid' }) },
    ]);
    await h.store.ensureCollection();
    expect((await h.store.getStats()).count).toBe(2);
  } finally { await h.close(); }
});
