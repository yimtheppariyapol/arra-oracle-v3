/**
 * Guards: ORACLE_OLLAMA_NUM_THREAD reaches Ollama as options.num_thread, and is absent when unset.
 * Without it, box Ollama used all 8 vCPUs during the backfill (load1 8 -> 15.8, 2026-11-01 pilot).
 */
import { expect, test } from 'bun:test';
import { OllamaEmbeddings } from '../embeddings.ts';

test('num_thread is sent only when configured', async () => {
  const original = globalThis.fetch; const saved = process.env.ORACLE_OLLAMA_NUM_THREAD;
  try {
    const bodies: any[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ embeddings: [[1, 0]] });
    }) as typeof fetch;
    process.env.ORACLE_OLLAMA_NUM_THREAD = '4';
    await new OllamaEmbeddings({ baseUrl: 'http://stub', model: 'bge-m3' }).embedPassageBatch(['a']);
    delete process.env.ORACLE_OLLAMA_NUM_THREAD;
    await new OllamaEmbeddings({ baseUrl: 'http://stub', model: 'bge-m3' }).embedPassageBatch(['a']);
    expect(bodies[0].options).toEqual({ num_thread: 4 });
    expect(bodies[1].options).toBeUndefined();
  } finally {
    globalThis.fetch = original;
    if (saved === undefined) delete process.env.ORACLE_OLLAMA_NUM_THREAD; else process.env.ORACLE_OLLAMA_NUM_THREAD = saved;
  }
});
