import { expect, test } from 'bun:test';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmbeddingCache, embeddingCacheKey, CHUNKER_VERSION } from '../embedding-cache.ts';

test('old JSON entries cannot masquerade as float32 hits and count toward the size cap', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cache-legacy-'));
  try {
    const identity = { model: 'fake', digest: 'v1', dimensions: 1 };
    const key = embeddingCacheKey(identity, 'a', CHUNKER_VERSION);
    // Four bytes: exactly the size of a one-dimensional binary entry.
    await writeFile(join(dir, key), '[10]');
    let calls = 0;
    const provider = { name: 'fake', dimensions: 1, embed: async () => { calls++; return [[20]]; } };
    const cache = new EmbeddingCache(dir, 4);
    const result = await cache.vectors([{ id: 'a', document: 'a', metadata: {} }], provider, identity);
    expect(calls).toBe(1);
    expect(result.documents[0].vector).toEqual([20]);
    expect(await readdir(dir)).toEqual([`${key}.f32`]);
  } finally { await rm(dir, { recursive: true }); }
});
