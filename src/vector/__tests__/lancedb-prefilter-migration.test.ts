import { expect, test } from 'bun:test';
import { connect } from '@lancedb/lancedb';
import { prefilterHarness, queryVector } from './lancedb-prefilter-harness.ts';

test('legacy JSON-only rows upgrade in place with typed metadata and epoch dates', async () => {
  const h = await prefilterHarness();
  try {
    await h.store.deleteCollection();
    const db = await connect(h.directory);
    await db.createTable('filtered', [{ id: 'legacy', text: 'legacy text', vector: queryVector,
      metadata: JSON.stringify({ house: 'old-house', tenant_id: 'old-tenant', doc_date: 1_700_000_000_123,
        source_kind: 'learning', source_file: 'old.md', model_key: 'bge-m3', chunker_version: 'v1' }) }]);
    await h.store.ensureCollection(); await h.store.ensureCollection();
    const result = await h.store.query('query', 10, { tenant_id: 'old-tenant', house: 'old-house', doc_date: 1_700_000_000_123 });
    expect(result.ids).toEqual(['legacy']);
    const table = await db.openTable('filtered');
    const row = (await table.query().toArray())[0];
    expect(row.doc_date).toBe(1_700_000_000_123); expect(typeof row.tenant_id).toBe('string');
    expect((await table.schema()).fields.find((field) => field.name === 'doc_date')?.type.toString()).toBe('Float64');
  } finally { await h.close(); }
});
