import type { OracleDbInput } from '../db/drizzle-input.ts';
import { EmbeddingCache, CHUNKER_VERSION, type EmbeddingIdentity } from '../vector/embedding-cache.ts';
import type { EmbeddingProvider, VectorStoreAdapter } from '../vector/types.ts';
import { readVectorDocuments } from './vector-documents.ts';
import { loadVectorIndexManifest, planVectorIndex, writeVectorIndexManifest } from './vector-index-manifest.ts';

export interface IncrementalVectorDeps {
  db: OracleDbInput;
  modelKey: string;
  store: VectorStoreAdapter;
  embedder: EmbeddingProvider;
  cache: EmbeddingCache;
  identity?: EmbeddingIdentity;
  chunkerVersion?: string;
}

/** The returned commit runs only after every vector write/delete has committed. */
export async function writeIncrementalVectors(deps: IncrementalVectorDeps, ids: string[], force = false) {
  const states = readVectorDocuments(deps.db, ids);
  const snapshots = new Map([...states].map(([id, state]) => [id, JSON.stringify(state)]));
  const docs = [...states.values()].flatMap((state) => state.doc ? [state.doc] : []);
  const identity = docs.length ? deps.identity ?? await deps.embedder.getIdentity?.() : undefined;
  if (docs.length && !identity?.digest) throw new Error('Incremental indexing requires an immutable model digest');
  const chunkerVersion = deps.chunkerVersion ?? CHUNKER_VERSION;
  for (const doc of docs) Object.assign(doc.metadata, {
    model_key: deps.modelKey, model_digest: identity!.digest, chunker_version: chunkerVersion,
    embedding_model: identity!.model, embedding_dimensions: identity!.dimensions,
  });
  const allPrevious = loadVectorIndexManifest(deps.db, deps.modelKey);
  const previous = new Map([...allPrevious].filter(([id]) => states.has(id)));
  const plan = planVectorIndex(docs, previous, deps.modelKey, { force });
  // Tombstones also delete orphan rows left by a crash before the first manifest commit.
  const tombstones = [...states].filter(([, state]) => state.reason !== null).map(([id]) => id);
  plan.staleIds = [...new Set([...plan.staleIds, ...tombstones])];
  let embedded = 0;
  if (plan.changedDocs.length) {
    const cached = await deps.cache.vectors(plan.changedDocs, deps.embedder, identity!, chunkerVersion);
    await (deps.store.upsertVectors?.(cached.documents) ?? deps.store.addDocuments(cached.documents));
    embedded = cached.embedded;
  }
  if (plan.staleIds.length) {
    if (!deps.store.deleteDocuments) throw new Error('Incremental store must support tombstones');
    await deps.store.deleteDocuments(plan.staleIds);
  }
  return { plan, states, embedded, changedDuringWrite() {
    const current = readVectorDocuments(deps.db, ids);
    return new Set(ids.filter((id) => JSON.stringify(current.get(id)) !== snapshots.get(id)));
  }, commit() {
    if (!writeVectorIndexManifest(deps.db, plan)) throw new Error('Vector manifest migration is required');
  } };
}
