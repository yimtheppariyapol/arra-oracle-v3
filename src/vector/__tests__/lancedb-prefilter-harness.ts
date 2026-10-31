import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LanceDBAdapter } from '../adapters/lancedb.ts';
import type { EmbeddingProvider, VectorDocument } from '../types.ts';

export const queryVector = [1, 0, 0, 0, 0, 0, 0, 0];
export const fakeEmbedder: EmbeddingProvider = {
  name: 'fake', dimensions: 8,
  async embed(texts, type) {
    if (type !== 'query') throw new Error('Storage must use supplied vectors');
    return texts.map(() => queryVector);
  },
};
export async function prefilterHarness() {
  const directory = await mkdtemp(join(tmpdir(), 'lance-prefilter-'));
  const store = new LanceDBAdapter('filtered', directory, fakeEmbedder);
  await store.connect(); await store.ensureCollection();
  return { store, directory, async close() { await store.close(); await rm(directory, { recursive: true }); } };
}
export function selectiveDocs(): VectorDocument[] {
  return Array.from({ length: 1000 }, (_, i) => ({
    id: `d${i}`, document: `document ${i}`,
    vector: i < 970 ? [1, 0.001 * (i + 1), 0, 0, 0, 0, 0, 0] : [0.1, 1, i * 0.001, 0, 0, 0, 0, 0],
    metadata: { house: i < 970 ? 'common' : 'rare', tenant_id: i < 970 ? 'tenant-a' : 'tenant-b',
      source_kind: 'learning', source_file: `ψ/memory/${i}.md`, doc_date: 1_700_000_000_000 + i,
      model_key: 'bge-m3', chunker_version: 'paragraph-800-v1' },
  }));
}
