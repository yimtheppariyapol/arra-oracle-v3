import { expect, test } from 'bun:test';
import { localStore, closeLocalStore, TEST_DOCS, SQLITE_VEC_AVAILABLE } from './local-adapter-harness.ts';

for (const kind of ['lancedb', 'sqlite-vec'] as const) {
  test.skipIf(kind === 'sqlite-vec' && !SQLITE_VEC_AVAILABLE)(`${kind} local contract: connect`, async () => {
    const store = await localStore(kind);
    try {
      await store.connect(); await store.ensureCollection();
      const info = await store.getCollectionInfo();
      expect(info.count).toBe(0); expect(info.name).toContain('oracle_test_');
    } finally { await closeLocalStore(store); }
  });
}
