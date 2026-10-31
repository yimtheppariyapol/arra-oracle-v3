import { expect, test } from 'bun:test';
import { localStore, closeLocalStore, TEST_DOCS, SQLITE_VEC_AVAILABLE } from './local-adapter-harness.ts';

for (const kind of ['lancedb', 'sqlite-vec'] as const) {
  test.skipIf(kind === 'sqlite-vec' && !SQLITE_VEC_AVAILABLE)(`${kind} local contract: neighbors`, async () => {
    const store = await localStore(kind);
    try {
      await store.connect(); await store.ensureCollection();
      await store.addDocuments(TEST_DOCS);
      const result = await store.queryById('test_1', 3);
      expect(result.ids).toHaveLength(3); expect(result.ids).not.toContain('test_1');
    } finally { await closeLocalStore(store); }
  });
}
