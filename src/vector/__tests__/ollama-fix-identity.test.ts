import { expect, test } from 'bun:test';
import { ollamaIdentity } from '../ollama-identity.ts';

test('Ollama identity resolves latest aliases and fails closed on missing digest or unavailable tags', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://stub/api/tags');
      return Response.json({ models: [{ name: 'bge-m3:latest', digest: 'immutable' }] });
    }) as typeof fetch;
    expect(await ollamaIdentity('http://stub', 'bge-m3', 1024))
      .toEqual({ model: 'ollama:bge-m3', digest: 'immutable', dimensions: 1024 });
    globalThis.fetch = (async () => Response.json({ models: [] })) as typeof fetch;
    await expect(ollamaIdentity('http://stub', 'bge-m3', 1024)).rejects.toThrow('No Ollama digest');
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
    await expect(ollamaIdentity('http://stub', 'bge-m3', 1024)).rejects.toThrow('503');
  } finally { globalThis.fetch = original; }
});
