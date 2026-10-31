import { expect, test } from 'bun:test';
import { prefilterHarness, selectiveDocs, queryVector } from './lancedb-prefilter-harness.ts';

test('tenant and house filters compose without leakage, including quoted values', async () => {
  const h = await prefilterHarness();
  try {
    await h.store.addDocuments([...selectiveDocs(), {
      id: 'quoted', document: 'quoted metadata', vector: queryVector,
      metadata: { tenant_id: "tenant'b", house: "house' OR 1=1 --", doc_date: 123 },
    }]);
    for (const where of [{ tenant_id: 'tenant-b', house: 'rare' }, { tenant_id: 'tenant-a', house: 'rare' },
      { tenant_id: "tenant'b", house: "house' OR 1=1 --" }]) {
      const result = await h.store.queryByVector(queryVector, 10, where);
      expect(result.ids.length).toBe(where.tenant_id === 'tenant-a' ? 0 : where.tenant_id === 'tenant-b' ? 10 : 1);
      for (const meta of result.metadatas) expect(meta).toMatchObject(where);
    }
    await expect(h.store.query('query', 10, { 'tenant_id OR TRUE': 'tenant-b' })).rejects.toThrow('Unsupported');
  } finally { await h.close(); }
});
