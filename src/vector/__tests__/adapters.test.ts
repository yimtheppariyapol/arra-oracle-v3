/** Pure adapter factory/provider contracts. Local store behaviors use fake embedders in local-contract-*. */

import { describe, test, expect } from 'bun:test';
import { createVectorStore, createVectorStoreForModel } from '../factory.ts';
import { createEmbeddingProvider } from '../embeddings.ts';
import { SqliteVecAdapter } from '../adapters/sqlite-vec.ts';
import { LanceDBAdapter } from '../adapters/lancedb.ts';
import { QdrantAdapter, qdrantPointId } from '../adapters/qdrant.ts';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('EmbeddingProvider', () => {
  test('createEmbeddingProvider: chromadb-internal throws on embed()', async () => {
    const provider = createEmbeddingProvider('chromadb-internal');
    expect(provider.name).toBe('chromadb-internal');
    expect(provider.dimensions).toBe(384);
    await expect(provider.embed(['test'])).rejects.toThrow('internally');
  });

  test('injected embedder returns vectors without a model service', async () => {
    const provider = { name: 'fake', dimensions: 3,
      embed: async (texts: string[]) => texts.map(() => [1, 0, 0]) };
    expect(await provider.embed(['hello world', 'test embedding'])).toEqual([[1, 0, 0], [1, 0, 0]]);
  });
});

// ============================================================================
// Factory Tests
// ============================================================================

describe('createVectorStore factory', () => {
  test('defaults to lancedb', () => {
    const store = createVectorStore();
    expect(store.name).toBe('lancedb');
    expect(store).toBeInstanceOf(LanceDBAdapter);
  });

  test('creates sqlite-vec', () => {
    const tmpDb = path.join(os.tmpdir(), `oracle-test-factory-${Date.now()}.db`);
    const store = createVectorStore({
      type: 'sqlite-vec',
      dataPath: tmpDb,
      embeddingProvider: 'ollama',
    });
    expect(store.name).toBe('sqlite-vec');
    expect(store).toBeInstanceOf(SqliteVecAdapter);
    // Cleanup
    try { fs.unlinkSync(tmpDb); } catch {}
  });

  test('respects ORACLE_VECTOR_DB env', () => {
    const orig = process.env.ORACLE_VECTOR_DB;
    process.env.ORACLE_VECTOR_DB = 'sqlite-vec';
    process.env.ORACLE_VECTOR_DB_PATH = '/tmp/oracle-test-env.db';

    const store = createVectorStore();
    expect(store.name).toBe('sqlite-vec');

    // Restore
    if (orig) process.env.ORACLE_VECTOR_DB = orig;
    else delete process.env.ORACLE_VECTOR_DB;
    delete process.env.ORACLE_VECTOR_DB_PATH;
  });

  test('creates model store from per-collection adapter config', () => {
    const store = createVectorStoreForModel({
      collection: 'oracle_test_qdrant',
      model: 'bge-m3',
      adapter: 'qdrant',
    });

    expect(store.name).toBe('qdrant');
    expect(store).toBeInstanceOf(QdrantAdapter);
  });
});

describe('QdrantAdapter parity helpers', () => {
  test('qdrantPointId is a stable UUID, not a 32-bit integer hash', () => {
    const id = qdrantPointId('learning_2026-06-06_qdrant-parity');

    expect(id).toBe(qdrantPointId('learning_2026-06-06_qdrant-parity'));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.isInteger(Number(id))).toBe(false);
  });

  test('addDocuments honors doc.vector and embeds only missing vectors', async () => {
    const embedCalls: string[][] = [];
    const embedder = {
      name: 'fake',
      dimensions: 3,
      embed: async (texts: string[]) => {
        embedCalls.push(texts);
        return texts.map((_, i) => [9 + i, 8 + i, 7 + i]);
      },
    };
    const upserts: any[] = [];
    const adapter = new QdrantAdapter('oracle_test_qdrant_parity', embedder);
    (adapter as any).client = {
      upsert: async (_collection: string, payload: any) => upserts.push(payload),
    };

    await adapter.addDocuments([
      { id: 'with-vector', document: 'already embedded', metadata: { type: 'learning' }, vector: [1, 2, 3] },
      { id: 'without-vector', document: 'needs embedding', metadata: { type: 'learning' } },
    ]);

    expect(embedCalls).toEqual([['needs embedding']]);
    expect(upserts[0].points[0].vector).toEqual([1, 2, 3]);
    expect(upserts[0].points[1].vector).toEqual([9, 8, 7]);
    expect(upserts[0].points[0].id).toBe(qdrantPointId('with-vector'));
  });
});
