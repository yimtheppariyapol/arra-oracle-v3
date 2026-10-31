import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withFileLock } from '../../utils/file-lock.ts';

test('a live kernel lock excludes another process and releases after owner death', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vector-kernel-lock-'));
  const file = join(directory, 'writer.lock');
  const module = join(import.meta.dir, '../../utils/file-lock.ts');
  const script = `import { withFileLock } from ${JSON.stringify(module)};
    await withFileLock(${JSON.stringify(file)}, async () => {
      console.log('locked'); await Bun.sleep(60000);
    });`;
  const child = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' });
  try {
    const reader = child.stdout.getReader();
    const first = await reader.read(); reader.releaseLock();
    expect(new TextDecoder().decode(first.value)).toContain('locked');
    await expect(withFileLock(file, async () => 'stolen', 100)).rejects.toThrow('lock held');
    child.kill('SIGKILL'); await child.exited;
    expect(await withFileLock(file, async () => 'recovered', 500)).toBe('recovered');
  } finally { child.kill(); await child.exited; await rm(directory, { recursive: true }); }
}, 10000);
