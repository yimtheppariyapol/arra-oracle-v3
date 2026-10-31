import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LanceDBAdapter } from '../adapters/lancedb.ts';
import { SqliteVecAdapter } from '../adapters/sqlite-vec.ts';
import type { VectorStoreAdapter, VectorDocument, EmbeddingProvider } from '../types.ts';

export const fakeEmbedder: EmbeddingProvider = {
  name: 'fake', dimensions: 8,
  async embed(texts) {
    return texts.map((text) => /git|history|preserv|Nothing/i.test(text)
      ? [1, 0, 0, 0, 0, 0, 0, 0] : [0, 1, 0.1, 0, 0, 0, 0, 0]);
  },
};
const directories = new WeakMap<VectorStoreAdapter, string>();
export async function localStore(kind: 'lancedb' | 'sqlite-vec'): Promise<VectorStoreAdapter> {
  const dir = await mkdtemp(join(tmpdir(), 'local-adapter-'));
  const store = kind === 'lancedb' ? new LanceDBAdapter('oracle_test_lancedb', dir, fakeEmbedder)
    : new SqliteVecAdapter('oracle_test_sqlite', join(dir, 'vectors.db'), fakeEmbedder);
  directories.set(store, dir);
  return store;
}
export async function closeLocalStore(store: VectorStoreAdapter) {
  await store.close();
  const dir = directories.get(store);
  if (dir) await rm(dir, { recursive: true });
}
export const SQLITE_VEC_AVAILABLE = (() => {
  const db = new Database(':memory:');
  try { db.loadExtension(require('sqlite-vec').getLoadablePath()); return true; }
  catch { return false; }
  finally { db.close(); }
})();

export const TEST_DOCS: VectorDocument[] = [
  {
    id: 'test_1',
    document: 'Nothing is deleted. Create new, do not delete. Git history is sacred.',
    metadata: { type: 'principle', source_file: 'test/resonance.md' },
  },
  {
    id: 'test_2',
    document: 'Patterns over intentions. Watch what the code actually does.',
    metadata: { type: 'principle', source_file: 'test/resonance.md' },
  },
  {
    id: 'test_3',
    document: 'External brain, not command. Mirror reality. Present options.',
    metadata: { type: 'principle', source_file: 'test/resonance.md' },
  },
  {
    id: 'test_4',
    document: 'TypeScript Hono API with SQLite FTS5 for full text search.',
    metadata: { type: 'learning', source_file: 'test/learning.md' },
  },
  {
    id: 'test_5',
    document: 'ChromaDB vector embeddings for semantic similarity search.',
    metadata: { type: 'learning', source_file: 'test/learning.md' },
  },
];

