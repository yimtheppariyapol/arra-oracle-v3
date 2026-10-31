import { dlopen, read } from 'bun:ffi';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

function loadFlock() {
  const darwin = process.platform === 'darwin';
  if (!darwin && process.platform !== 'linux') throw new Error('Vector locks require Unix flock support');
  const library = darwin ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6';
  const lock = dlopen(library, { flock: { args: ['i32', 'i32'], returns: 'i32' } });
  const errnoName = darwin ? '__error' : '__errno_location';
  const errors = dlopen(library, { [errnoName]: { args: [], returns: 'ptr' } });
  return {
    flock: lock.symbols.flock,
    errno() {
      const pointer = errors.symbols[errnoName]();
      if (!pointer) throw new Error('Cannot read flock errno');
      return read.i32(pointer);
    },
    wouldBlock: darwin ? 35 : 11,
  };
}
let native: ReturnType<typeof loadFlock> | undefined;

/** Kernel-held ownership dies with the process, regardless of reboot/PID reuse or file contents. */
export async function withFileLock<T>(file: string, operation: () => Promise<T>, timeoutMs = 60_000): Promise<T> {
  native ??= loadFlock();
  mkdirSync(dirname(file), { recursive: true });
  // Keep one stable inode: unlinking a flock file allows concurrent owners of different inodes.
  const fd = openSync(file, 'a+');
  const start = Date.now();
  let delay = 25;
  try {
    while (native.flock(fd, 2 | 4) !== 0) { // LOCK_EX | LOCK_NB
      const errno = native.errno();
      if (errno !== native.wouldBlock && errno !== 4) throw new Error(`flock failed (${errno}) at ${file}`);
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 0) throw new Error(`Vector writer unavailable: lock held at ${file}`);
      await Bun.sleep(Math.min(delay, remaining));
      delay = Math.min(1000, delay * 2);
    }
    return await operation();
  } finally {
    // close also releases ownership on exceptions. The kernel closes it after a crash.
    closeSync(fd);
  }
}
