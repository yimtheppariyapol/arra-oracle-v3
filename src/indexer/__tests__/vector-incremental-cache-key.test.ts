import { expect, test } from 'bun:test';
import { embeddingCacheKey } from '../../vector/embedding-cache.ts';

test('cache keys distinguish identity, digest, prepared text, dimensions, and chunker version', () => {
  const identity = { model: 'ollama:bge-m3', digest: 'v1', dimensions: 1024 };
  const keys = [
    embeddingCacheKey(identity, 'passage: text', 'chunks-v1'),
    embeddingCacheKey({ ...identity, model: 'other' }, 'passage: text', 'chunks-v1'),
    embeddingCacheKey({ ...identity, digest: 'v2' }, 'passage: text', 'chunks-v1'),
    embeddingCacheKey({ ...identity, dimensions: 768 }, 'passage: text', 'chunks-v1'),
    embeddingCacheKey(identity, 'query: text', 'chunks-v1'),
    embeddingCacheKey(identity, 'passage: text', 'chunks-v2'),
  ];
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys.every((key) => /^[a-f0-9]{64}$/.test(key))).toBe(true);
});
