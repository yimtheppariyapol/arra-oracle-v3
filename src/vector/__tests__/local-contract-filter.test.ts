import { expect, test } from 'bun:test';
import { localStore, closeLocalStore, TEST_DOCS, SQLITE_VEC_AVAILABLE } from './local-adapter-harness.ts';

for (const kind of ['lancedb', 'sqlite-vec'] as const) {
  test.skipIf(kind === 'sqlite-vec' && !SQLITE_VEC_AVAILABLE)(`${kind} local contract: filter`, async () => {
    const store = await localStore(kind);
    try {
      await store.connect(); await store.ensureCollection();
      await store.addDocuments(TEST_DOCS);
      const result = await store.query('search technology', 5, { type: 'learning' });
      expect(result.ids).toHaveLength(2);
      expect(result.metadatas.every((meta) => meta.type === 'learning')).toBe(true);
    } finally { await closeLocalStore(store); }
  });
}
