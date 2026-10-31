import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('a second worker cannot steal live claims during restart recovery', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'shared'); h.enqueue('a');
    let started!: () => void; const claimed = new Promise<void>((resolve) => { started = resolve; });
    let unblock!: () => void; const block = new Promise<void>((resolve) => { unblock = resolve; });
    const embed = h.embedder.embed;
    h.embedder.embed = async (...args) => { started(); await block; return embed(...args); };
    const first = h.run();
    await claimed;
    const second = h.run();
    await Bun.sleep(50);
    expect(h.sqlite.query('SELECT status, attempts FROM indexing_jobs').get()).toEqual({ status: 'claimed', attempts: 1 });
    unblock();
    await Promise.all([first, second]);
    expect(h.calls).toHaveLength(1);
    expect(h.sqlite.query('SELECT status, attempts FROM indexing_jobs').get()).toEqual({ status: 'done', attempts: 1 });
  } finally { await h.close(); }
});
