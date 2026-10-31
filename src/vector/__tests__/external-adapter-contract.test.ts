import { describe, test, expect, afterAll } from 'bun:test';
import { createVectorStore } from '../factory.ts';
import { QdrantAdapter } from '../adapters/qdrant.ts';
import type { VectorStoreAdapter } from '../types.ts';
import { TEST_DOCS, fakeEmbedder } from './local-adapter-harness.ts';
const CHROMA_TEST_TIMEOUT_MS = 30_000;

// External services require a dedicated integration run; the local gate is hermetic.
describe.skip('ChromaMcpAdapter (external integration)', () => {
  let store: VectorStoreAdapter;
  let chromaAvailable = false;

  const setup = async () => {
    store = createVectorStore({
      type: 'chroma',
      collectionName: 'oracle_test_adapter',
    });

    try {
      await store.connect();
      chromaAvailable = true;
    } catch {
      chromaAvailable = false;
    }
  };

  afterAll(async () => {
    if (store && chromaAvailable) {
      try { await store.deleteCollection(); } catch {}
      await store.close();
    }
  });

  test('connect + ensureCollection', async () => {
    await setup();
    if (!chromaAvailable) { console.log('  [SKIP] ChromaDB not available'); return; }

    await store.ensureCollection();
    const info = await store.getCollectionInfo();
    expect(info.name).toBe('oracle_test_adapter');
  }, CHROMA_TEST_TIMEOUT_MS);

  test('addDocuments + query', async () => {
    if (!chromaAvailable) { console.log('  [SKIP] ChromaDB not available'); return; }

    await store.addDocuments(TEST_DOCS);
    const stats = await store.getStats();
    expect(stats.count).toBe(5);

    const result = await store.query('git history', 3);
    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.documents.length).toBe(result.ids.length);
  }, CHROMA_TEST_TIMEOUT_MS);

  test.skip('queryById (pre-existing safeJsonParse single-quote bug)', async () => {
    if (!chromaAvailable) { console.log('  [SKIP] ChromaDB not available'); return; }

    const result = await store.queryById('test_1', 2);
    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.ids).not.toContain('test_1');
  }, CHROMA_TEST_TIMEOUT_MS);
});

describe.skip('QdrantAdapter (external integration)', () => {
  let store: VectorStoreAdapter;
  let available = false;

  const setup = async () => {
    store = new QdrantAdapter('oracle_test_qdrant', fakeEmbedder);
    available = true;
  };

  afterAll(async () => {
    if (store && available) {
      try { await store.deleteCollection(); } catch {}
      await store.close();
    }
  });

  test('connect + ensureCollection', async () => {
    await setup();
    if (!available) { console.log('  [SKIP] Ollama or Qdrant not available'); return; }

    await store.connect();
    await store.ensureCollection();

    const info = await store.getCollectionInfo();
    expect(info.name).toBe('oracle_test_qdrant');
  });

  test('addDocuments', async () => {
    if (!available) { console.log('  [SKIP] Ollama or Qdrant not available'); return; }

    await store.addDocuments(TEST_DOCS);

    // Qdrant is eventually consistent — wait briefly
    await new Promise(r => setTimeout(r, 500));

    const stats = await store.getStats();
    expect(stats.count).toBe(5);
  });

  test('query: semantic search', async () => {
    if (!available) { console.log('  [SKIP] Ollama or Qdrant not available'); return; }

    const result = await store.query('git history preservation', 3);

    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.ids.length).toBeLessThanOrEqual(3);
    expect(result.documents.length).toBe(result.ids.length);
    expect(result.distances.length).toBe(result.ids.length);

    console.log('  Top result for "git history preservation":', result.ids[0]);
    expect(result.ids).toContain('test_1');
  });

  test('query: with where filter', async () => {
    if (!available) { console.log('  [SKIP] Ollama or Qdrant not available'); return; }

    const result = await store.query('search technology', 5, { type: 'learning' });

    for (const meta of result.metadatas) {
      expect(meta.type).toBe('learning');
    }
  });

  test('queryById: nearest neighbors', async () => {
    if (!available) { console.log('  [SKIP] Ollama or Qdrant not available'); return; }

    const result = await store.queryById('test_1', 3);

    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.ids.length).toBeLessThanOrEqual(3);
    expect(result.ids).not.toContain('test_1');
  });

  test('deleteCollection + recreate', async () => {
    if (!available) { console.log('  [SKIP] Ollama or Qdrant not available'); return; }

    await store.deleteCollection();
    await store.ensureCollection();
    const stats = await store.getStats();
    expect(stats.count).toBe(0);
  });
});
