import { expect, setSystemTime, test } from 'bun:test';
import { join } from 'node:path';
import { withFileLock } from '../../utils/file-lock.ts';
import { prefilterHarness } from './lancedb-prefilter-harness.ts';

test('a second opener waits through a migration lasting longer than 60 seconds', async () => {
  const h = await prefilterHarness();
  let opening: Promise<unknown> | undefined;
  try {
    await withFileLock(join(h.directory, '.migrate-filtered.lock'), async () => {
      opening = h.store.ensureCollection().then(() => 'opened', (error) => String(error));
      await Bun.sleep(50);
      setSystemTime(new Date(Date.now() + 61_000));
      await Bun.sleep(250);
    });
    expect(await opening).toBe('opened');
  } finally { setSystemTime(); await opening; await h.close(); }
});
