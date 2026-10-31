import type { EmbeddingProvider, VectorDocument } from './types.ts';
import { validateVector } from './embedding-cache.ts';

/** Text-only compatibility stays at the boundary. Storage consumes these validated vectors. */
export async function documentVectors(docs: VectorDocument[], embedder: EmbeddingProvider): Promise<number[][]> {
  const missing = docs.filter((doc) => doc.vector === undefined);
  const fresh = missing.length ? await embedder.embed(missing.map((doc) => doc.document), 'passage') : [];
  if (fresh.length !== missing.length) throw new Error('Embedding batch cardinality mismatch');
  let i = 0;
  return docs.map((doc) => {
    const vector = doc.vector ?? fresh[i++];
    validateVector(vector, embedder.dimensions);
    return vector;
  });
}
