import { expect, test } from 'bun:test';
import { connect } from '@lancedb/lancedb';
import { prefilterHarness, queryVector } from './lancedb-prefilter-harness.ts';

test('migration repairs house on rows already converted by metadata version one', async () => {
  const h = await prefilterHarness();
  try {
    await h.store.upsertVectors([{ id: 'a', document: 'a', vector: queryVector, metadata: { project: 'p' } }]);
    const table = await (await connect(h.directory)).openTable('filtered');
    await table.update({ values: { metadata_version: 1, house: '' } });
    await h.store.ensureCollection();
    expect((await h.store.queryByVector(queryVector, 10, { house: 'p' })).ids).toEqual(['a']);
  } finally { await h.close(); }
});
