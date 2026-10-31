import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('embedding outages pause without consuming attempts and recover later', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'outage'); h.enqueue('a');
    const embed = h.embedder.embed;
    h.embedder.embed = async () => { throw new Error('Ollama API error (503): unavailable'); };
    let stopped = false;
    setTimeout(() => { stopped = true; }, 100);
    await h.run({ isShuttingDown: () => stopped, onEvent: () => {},
      pollIntervalMs: 1, onPause: () => { stopped = true; } });
    expect(h.sqlite.query('SELECT status, attempts FROM indexing_jobs').get()).toEqual({ status: 'pending', attempts: 0 });
    h.embedder.embed = embed;
    await h.run();
    expect((await h.store.getAllEmbeddings()).ids).toEqual(['a']);
  } finally { await h.close(); }
}, 10000);
