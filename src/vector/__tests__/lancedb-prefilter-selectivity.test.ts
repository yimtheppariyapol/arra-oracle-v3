import { expect, test } from 'bun:test';
import { prefilterHarness, selectiveDocs } from './lancedb-prefilter-harness.ts';

test('3% filter returns k matching neighbors even when every global top-3k row fails the filter', async () => {
  const h = await prefilterHarness();
  try {
    await h.store.addDocuments(selectiveDocs());
    const global = await h.store.query('query', 30);
    expect(global.metadatas.every((meta) => meta.house === 'common')).toBe(true);
    const result = await h.store.query('query', 10, { house: 'rare' });
    expect(result.ids).toHaveLength(10);
    expect(result.metadatas.every((meta) => meta.house === 'rare')).toBe(true);
    const { connect } = await import('@lancedb/lancedb');
    const table = await (await connect(h.directory)).openTable('filtered');
    const indexed = (await table.listIndices()).flatMap((index) => index.columns);
    for (const key of ['house', 'source_kind', 'source_file', 'doc_date', 'tenant_id', 'model_key', 'chunker_version']) {
      expect(indexed).toContain(key);
    }
  } finally { await h.close(); }
});
