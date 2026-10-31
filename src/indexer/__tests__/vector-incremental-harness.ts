import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../db/create.ts';
import { oracleDocuments, oracleFts } from '../../db/schema.ts';
import { EmbeddingCache } from '../../vector/embedding-cache.ts';
import { LanceDBAdapter } from '../../vector/adapters/lancedb.ts';
import type { EmbeddingProvider } from '../../vector/types.ts';
import { enqueueIndexJob } from '../jobs.ts';
import { runWorker } from '../worker.ts';
import type { IncrementalWorkerDeps } from '../incremental-worker.ts';

export async function incrementalHarness() {
  const dir = await mkdtemp(join(tmpdir(), 'vector-incremental-'));
  let connection = createDatabase(join(dir, 'oracle.db'));
  const calls: string[][] = [];
  let digest = 'sha256:fake-v1';
  const embedder: EmbeddingProvider = {
    name: 'fake-bge', dimensions: 8,
    prepareText: (text) => `passage: ${text.slice(0, 2000)}`,
    getIdentity: async () => ({ model: 'fake:bge-m3', digest, dimensions: 8 }),
    async embed(texts) {
      calls.push([...texts]);
      return texts.map((text) => Array.from({ length: 8 }, (_, i) =>
        (text.charCodeAt(i % text.length) + i + 1) / 256));
    },
  };
  const storageEmbedder: EmbeddingProvider = {
    name: 'storage-must-not-embed', dimensions: 8,
    embed: async () => { throw new Error('Store re-embedded a supplied vector'); },
  };
  let store = new LanceDBAdapter('chunks', join(dir, 'lance'), storageEmbedder);
  await store.connect();
  await store.ensureCollection();
  const cache = () => new EmbeddingCache(join(dir, 'cache'));
  const deps = () => ({ db: connection.sqlite, modelKey: 'bge-m3', store, embedder, cache: cache() });
  return {
    dir, calls, embedder, cache, deps,
    get db() { return connection.db; }, get sqlite() { return connection.sqlite; },
    get store() { return store; },
    setDigest(value: string) { digest = value; },
    put(id: string, text: string, source = 'ψ/memory/learnings/test.md', metadata: { project?: string } = {}) {
      connection.db.insert(oracleDocuments).values({ id, type: 'learning', sourceFile: source,
        concepts: '[]', createdBy: 'indexer', createdAt: 1, updatedAt: 1, indexedAt: 1, ...metadata })
        .onConflictDoUpdate({ target: oracleDocuments.id, set: { sourceFile: source, ...metadata } }).run();
      connection.db.delete(oracleFts).where(eq(oracleFts.id, id)).run();
      connection.db.insert(oracleFts).values({ id, content: text, concepts: '[]' }).run();
    },
    enqueue(...ids: string[]) {
      for (const docId of ids) enqueueIndexJob(connection.sqlite,
        { docId, models: { 'bge-m3': { collection: 'chunks' } } });
    },
    async run(overrides: Partial<IncrementalWorkerDeps> = {}) {
      let idle = false;
      return runWorker('bge-m3', {
        db: connection.sqlite, incremental: { ...deps(), collection: 'chunks' },
        isShuttingDown: () => idle, pollIntervalMs: 1,
        onEvent: (event) => { if (event.type === 'idle') idle = true; }, ...overrides,
      });
    },
    async restart() {
      await store.close(); connection.sqlite.close();
      connection = createDatabase(join(dir, 'oracle.db'));
      store = new LanceDBAdapter('chunks', join(dir, 'lance'), storageEmbedder);
      await store.connect(); await store.ensureCollection();
    },
    async close() { await store.close(); connection.sqlite.close(); await rm(dir, { recursive: true }); },
  };
}
