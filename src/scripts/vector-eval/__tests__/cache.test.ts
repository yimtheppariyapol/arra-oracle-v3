import { expect, test } from 'bun:test';
import { CachedEmbedder, cacheKey, modelInput } from '../embeddings.ts';

test('disk cache avoids repeat embedding calls and separates model revisions and prepared inputs', async () => {
  let calls = 0;
  const request = (async (_url: string, init: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init.body));
    expect(body.input.length).toBeLessThanOrEqual(64);
    return Response.json({ embeddings: body.input.map(() => [3, 4]) });
  }) as typeof fetch;
  const revision = `test-${crypto.randomUUID()}`;
  const first = new CachedEmbedder('bge-m3', revision, 1, request);
  expect((await first.embed(['first', 'second'])).length).toBe(2);
  expect(calls).toBe(2);
  const second = new CachedEmbedder('bge-m3', revision, 1, request);
  const vectors = await second.embed(['first', 'second']);
  expect(calls).toBe(2);
  expect(second.hits).toBe(2);
  expect(vectors[0][0]).toBeCloseTo(0.6);
  expect(vectors[0][1]).toBeCloseTo(0.8);
  expect(cacheKey('model-a', 'text')).not.toBe(cacheKey('model-b', 'text'));
  expect(cacheKey('model-a', 'text')).not.toBe(cacheKey('model-a', 'other'));
  expect(modelInput('bge-m3', 'same', true)).not.toBe(modelInput('bge-m3', 'same', false));
  expect(() => new CachedEmbedder('bge-m3', revision, 65)).toThrow();
});
