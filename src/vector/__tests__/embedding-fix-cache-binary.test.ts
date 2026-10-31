import { expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmbeddingCache } from '../embedding-cache.ts';

test('embedding cache stores float32 data and evicts least recently used entries at its byte cap', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cache-cap-'));
  try {
    let calls = 0;
    const provider = { name: 'fake', dimensions: 4, embed: async (texts: string[]) => { calls++; return texts.map(() => [0.1, 0.2, 0.3, 0.4]); } };
    const cache = new EmbeddingCache(dir, 32);
    const identity = { model: 'fake', digest: 'v1', dimensions: 4 };
    const doc = (id: string) => [{ id, document: id, metadata: {} }];
    await cache.vectors(doc('a'), provider, identity);
    await cache.vectors(doc('b'), provider, identity);
    await cache.vectors(doc('a'), provider, identity);
    await cache.vectors(doc('c'), provider, identity);
    const files = await readdir(dir);
    expect(files).toHaveLength(2);
    expect((await readFile(join(dir, files[0]))).byteLength).toBe(16);
    await cache.vectors(doc('a'), provider, identity);
    expect(calls).toBe(3);
    await cache.vectors(doc('b'), provider, identity);
    expect(calls).toBe(4);
  } finally { await rm(dir, { recursive: true }); }
});
