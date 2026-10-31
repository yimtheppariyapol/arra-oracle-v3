import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Cross-process exclusive lock. Dead owners are reclaimed; live owners are never evicted by age. */
export async function withFileLock<T>(file: string, operation: () => Promise<T>, timeoutMs = 60_000): Promise<T> {
  mkdirSync(dirname(file), { recursive: true });
  const start = Date.now();
  const token = `${process.pid}:${crypto.randomUUID()}`;
  const candidate = `${file}.${token}`;
  // Publish an already-complete owner file atomically: a crash cannot leave an empty lock.
  writeFileSync(candidate, token, { flag: 'wx' });
  try {
    for (;;) {
      try { linkSync(candidate, file); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const owner = readFileSync(file, 'utf8');
          const pid = Number(owner.split(':')[0]);
          if (pid > 0) {
            try { process.kill(pid, 0); }
            catch (reason) {
              if ((reason as NodeJS.ErrnoException).code === 'ESRCH' && readFileSync(file, 'utf8') === owner) unlinkSync(file);
            }
          }
        } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; }
        if (Date.now() - start >= timeoutMs) throw new Error(`Vector writer unavailable: lock held at ${file}`);
        await Bun.sleep(25);
      }
    }
    try { return await operation(); }
    finally { if (existsSync(file) && readFileSync(file, 'utf8') === token) unlinkSync(file); }
  } finally { unlinkSync(candidate); }
}
