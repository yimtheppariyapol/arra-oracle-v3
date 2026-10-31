import { expect, test } from 'bun:test';
import { localStore, closeLocalStore, TEST_DOCS, SQLITE_VEC_AVAILABLE } from './local-adapter-harness.ts';

for (const kind of ['lancedb', 'sqlite-vec'] as const) {
  test.skipIf(kind === 'sqlite-vec' && !SQLITE_VEC_AVAILABLE)(`${kind} local contract: export`, async () => {
    const store = await localStore(kind);
    try {
      await store.connect(); await store.ensureCollection();
      await store.addDocuments(TEST_DOCS);
      const all = await store.getAllEmbeddings!();
      expect(all.ids).toHaveLength(5); expect(all.embeddings).toHaveLength(5);
      expect(all.embeddings.every((vector) => vector.length === 8)).toBe(true); expect(all.metadatas).toHaveLength(5);
    } finally { await closeLocalStore(store); }
  });
}
