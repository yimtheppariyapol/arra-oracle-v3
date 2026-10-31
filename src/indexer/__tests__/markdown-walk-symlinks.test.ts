import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAllMarkdownFiles } from '../collectors.ts';

describe('getAllMarkdownFiles symlink handling', () => {
  test('walks a symlink cycle once, skips /learn origin links, .git and node_modules', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-md-walk-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-md-origin-'));
    try {
      const notes = path.join(tmp, 'owner', 'repo');
      fs.mkdirSync(notes, { recursive: true });
      const keep = path.join(notes, 'notes.md');
      fs.writeFileSync(keep, '# notes\n');
      // Cycle: a child link pointing back at the walk root.
      fs.symlinkSync(tmp, path.join(notes, 'loop'));
      // /learn convention: the studied repo linked in as `origin`.
      fs.writeFileSync(path.join(outside, 'README.md'), '# upstream\n');
      fs.symlinkSync(outside, path.join(notes, 'origin'));
      for (const skip of ['node_modules', '.git']) {
        fs.mkdirSync(path.join(notes, skip));
        fs.writeFileSync(path.join(notes, skip, 'x.md'), '# x\n');
      }

      expect(getAllMarkdownFiles(tmp)).toEqual([keep]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('still follows a symlinked knowledge dir that is not named origin', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-md-walk-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-md-linked-'));
    try {
      const linked = path.join(outside, 'trading.md');
      fs.writeFileSync(linked, '# trading\n');
      fs.symlinkSync(outside, path.join(tmp, 'watson-trading'));

      expect(getAllMarkdownFiles(tmp)).toEqual([path.join(tmp, 'watson-trading', 'trading.md')]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
