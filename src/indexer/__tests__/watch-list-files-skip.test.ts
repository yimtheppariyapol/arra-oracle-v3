/**
 * Guards: the learn-watcher's startup file scan skips node_modules and .git.
 * Without it, vendored READMEs under ψ/learn/.../node_modules were stored as knowledge on every
 * daemon start (2026-11-01: ioredis/debug/denque READMEs), each through the slow per-file store path.
 */
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listFiles } from '../watch-utils.ts';

describe('listFiles', () => {
  test('skips node_modules and .git like listDirs does', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-list-'));
    try {
      const keep = path.join(tmp, 'notes', 'keep.md');
      fs.mkdirSync(path.dirname(keep), { recursive: true });
      fs.writeFileSync(keep, '# keep\n');
      for (const skip of ['node_modules/pkg', '.git/x']) {
        fs.mkdirSync(path.join(tmp, 'notes', skip), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'notes', skip, 'README.md'), '# vendored\n');
      }
      expect(listFiles(tmp, (p) => p.endsWith('.md'))).toEqual([keep]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
