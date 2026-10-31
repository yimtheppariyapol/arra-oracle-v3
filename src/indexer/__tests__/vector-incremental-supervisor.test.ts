import { expect, test } from 'bun:test';
import { superviseWorker } from '../worker-supervisor.ts';

test('daemon observes worker rejection and retries until shutdown', async () => {
  let attempts = 0;
  let stopped = false;
  const errors: unknown[] = [];
  await superviseWorker(async () => {
    if (++attempts < 3) throw new Error('Vector writer unavailable: lock held');
    stopped = true;
  }, { isShuttingDown: () => stopped, onError: (error) => errors.push(error), retryMs: 1 });
  expect(attempts).toBe(3);
  expect(errors).toHaveLength(2);
});
