import { expect, test } from 'bun:test';
import { connect } from '@lancedb/lancedb';
import { prefilterHarness, queryVector } from './lancedb-prefilter-harness.ts';

test('migration derives house from legacy project for prefilters', async () => {
  const h = await prefilterHarness();
  try {
    await h.store.deleteCollection();
    await (await connect(h.directory)).createTable('filtered', [{ id: 'a', text: 'a', vector: queryVector,
      metadata: JSON.stringify({ project: 'old-house' }) }]);
    await h.store.ensureCollection();
    expect((await h.store.queryByVector(queryVector, 10, { house: 'old-house' })).ids).toEqual(['a']);
  } finally { await h.close(); }
});
