import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('a failed known-good passage probe pauses HTTP 500 outages without charging attempts', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'first'); h.put('b', 'second'); h.enqueue('a', 'b');
    const calls: string[][] = [];
    h.embedder.embedPassageBatch = async (texts) => {
      calls.push([...texts]);
      throw new Error('Ollama API error (500): model unavailable');
    };
    let stopped = false;
    await h.run({ isShuttingDown: () => stopped, onPause: () => { stopped = true; } });
    expect(calls).toEqual([['first', 'second'], ['health check']]);
    expect(h.sqlite.query('SELECT status, attempts FROM indexing_jobs').all())
      .toEqual([{ status: 'pending', attempts: 0 }, { status: 'pending', attempts: 0 }]);
    expect((await h.store.getStats()).count).toBe(0);
  } finally { await h.close(); }
});
