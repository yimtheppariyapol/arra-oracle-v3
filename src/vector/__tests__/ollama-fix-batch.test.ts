import { expect, test } from 'bun:test';
import { OllamaEmbeddings } from '../embeddings.ts';

test('Ollama passage batches send one prepared request and validate cardinality', async () => {
  const original = globalThis.fetch; const attempts = process.env.ORACLE_EMBED_ATTEMPTS;
  process.env.ORACLE_EMBED_ATTEMPTS = '1';
  try {
    const calls: any[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, JSON.parse(String(init.body))]);
      return Response.json({ embeddings: [[1, 0], [0, 1]] });
    }) as typeof fetch;
    const provider = new OllamaEmbeddings({ baseUrl: 'http://stub', model: 'bge-m3' });
    expect(await provider.embedPassageBatch(['a'.repeat(2100), 'b'])).toEqual([[1, 0], [0, 1]]);
    expect(calls).toEqual([['http://stub/api/embed', { model: 'bge-m3', input: ['passage: ' + 'a'.repeat(2000), 'passage: b'] }]]);
    await expect(provider.embedPassageBatch(['only one'])).rejects.toThrow('2 embeddings for 1 inputs');
  } finally {
    globalThis.fetch = original;
    if (attempts === undefined) delete process.env.ORACLE_EMBED_ATTEMPTS; else process.env.ORACLE_EMBED_ATTEMPTS = attempts;
  }
});
