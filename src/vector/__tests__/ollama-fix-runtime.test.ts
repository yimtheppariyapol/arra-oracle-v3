import { expect, test } from 'bun:test';
import { observeEmbeddingProvider, getEmbedderRuntimeStatus, clearEmbedderRuntimeStatusForTests } from '../embedder-config.ts';
import { OllamaEmbeddings } from '../embeddings.ts';

test('runtime wrapper preserves Ollama identity preparation and batch observation', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: string) => url.endsWith('/api/tags')
      ? Response.json({ models: [{ name: 'bge-m3:latest', digest: 'digest' }] })
      : Response.json({ embeddings: [[1, 0]] })) as typeof fetch;
    const provider = observeEmbeddingProvider(new OllamaEmbeddings({ baseUrl: 'http://stub', model: 'bge-m3' }),
      { provider: 'ollama', source: 'configured', explicit: true });
    expect(provider.prepareText?.('text', 'passage')).toBe('passage: text');
    expect((await provider.getIdentity?.())?.digest).toBe('digest');
    expect(await provider.embedPassageBatch?.(['text'])).toEqual([[1, 0]]);
    expect(getEmbedderRuntimeStatus().status).toBe('connected');
  } finally { globalThis.fetch = original; clearEmbedderRuntimeStatusForTests(); }
});
