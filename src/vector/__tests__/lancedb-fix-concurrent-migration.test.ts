import { expect, test } from 'bun:test';
import { connect } from '@lancedb/lancedb';
import { LanceDBAdapter } from '../adapters/lancedb.ts';
import { prefilterHarness, queryVector } from './lancedb-prefilter-harness.ts';

test('two concurrent openers serialize legacy metadata migration', async () => {
  const h = await prefilterHarness();
  const second = new LanceDBAdapter('filtered', h.directory, { name: 'fake', dimensions: queryVector.length,
    embed: async () => { throw new Error('no embedding'); } });
  try {
    await h.store.deleteCollection();
    await (await connect(h.directory)).createTable('filtered', [{ id: 'a', text: 'a', vector: queryVector, metadata: '{}' }]);
    await second.connect();
    await Promise.all([h.store.ensureCollection(), second.ensureCollection()]);
    expect((await h.store.getStats()).count).toBe(1);
    expect((await second.getStats()).count).toBe(1);
  } finally { await second.close(); await h.close(); }
});
