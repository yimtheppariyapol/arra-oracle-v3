import { expect, test } from 'bun:test';
import { localStore, closeLocalStore, TEST_DOCS, SQLITE_VEC_AVAILABLE } from './local-adapter-harness.ts';

for (const kind of ['lancedb', 'sqlite-vec'] as const) {
  test.skipIf(kind === 'sqlite-vec' && !SQLITE_VEC_AVAILABLE)(`${kind} local contract: upsert`, async () => {
    const store = await localStore(kind);
    try {
      await store.connect(); await store.ensureCollection();
      await store.addDocuments(TEST_DOCS); await store.addDocuments(TEST_DOCS);
      expect((await store.getStats()).count).toBe(5);
    } finally { await closeLocalStore(store); }
  });
}
