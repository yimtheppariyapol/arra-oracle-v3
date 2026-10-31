import { expect, test } from 'bun:test';
import { localStore, closeLocalStore, TEST_DOCS, SQLITE_VEC_AVAILABLE } from './local-adapter-harness.ts';

for (const kind of ['lancedb', 'sqlite-vec'] as const) {
  test.skipIf(kind === 'sqlite-vec' && !SQLITE_VEC_AVAILABLE)(`${kind} local contract: query`, async () => {
    const store = await localStore(kind);
    try {
      await store.connect(); await store.ensureCollection();
      await store.addDocuments(TEST_DOCS);
      const result = await store.query('git history preservation', 3);
      expect(result.ids.length).toBeGreaterThan(0); expect(result.ids.length).toBeLessThanOrEqual(3);
      expect(result.ids).toContain('test_1'); expect(result.documents.length).toBe(result.ids.length);
      expect(result.distances.length).toBe(result.ids.length);
    } finally { await closeLocalStore(store); }
  });
}
