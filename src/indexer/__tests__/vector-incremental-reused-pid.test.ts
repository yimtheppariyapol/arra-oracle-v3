import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withFileLock } from '../../utils/file-lock.ts';

test('an abandoned lock with a reused live PID and different process start time is reclaimed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reused-vector-pid-'));
  try {
    const file = join(dir, 'writer.lock');
    await writeFile(file, `${process.pid}:previous-boot:start-time=2000-01-01T00:00:00Z`);
    expect(await withFileLock(file, async () => 'acquired', 100)).toBe('acquired');
  } finally { await rm(dir, { recursive: true }); }
});
