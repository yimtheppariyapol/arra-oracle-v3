import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('SQLITE_BUSY at ack retries without crashing or re-embedding', async () => {
  const h = await incrementalHarness();
  const transaction = h.sqlite.transaction.bind(h.sqlite);
  let atAck = false; let retries = 0;
  h.sqlite.transaction = ((fn: (...args: any[]) => any) => {
    const real = transaction(fn);
    const wrapped = (...args: any[]) => {
      if (atAck && retries++ === 0) throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
      return real(...args);
    };
    return Object.assign(wrapped, { deferred: wrapped, immediate: wrapped, exclusive: wrapped });
  }) as typeof h.sqlite.transaction;
  try {
    h.put('a', 'ack'); h.enqueue('a');
    await h.run({ afterVectorCommit: () => { atAck = true; } });
    expect(retries).toBeGreaterThan(1);
    expect(h.sqlite.query('SELECT status FROM indexing_jobs').get()).toEqual({ status: 'done' });
    expect(h.calls).toHaveLength(1);
    expect(h.sqlite.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
  } finally { await h.close(); }
});
