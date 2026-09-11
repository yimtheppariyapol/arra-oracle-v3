/**
 * Proves the test preload (src/test-setup/hermetic.ts) is active and its guard can fire.
 * Run without the preload (`bun test -c <bunfig without preload> <this file>`), the first test
 * must fail: that is the negative control for "tests cannot touch real data".
 */
import { describe, expect, it } from 'bun:test';
import os from 'node:os';
import { assertHermetic } from '../../test-setup/assert-hermetic.ts';

describe('hermetic test setup', () => {
  it('resolves every data path inside the throwaway root', async () => {
    const root = process.env.ARRA_TEST_ROOT;
    expect(root).toBeTruthy();
    const cfg = await import('../../config.ts');
    for (const p of [cfg.ORACLE_DATA_DIR, cfg.DB_PATH, cfg.REPO_ROOT, cfg.LANCEDB_DIR, os.homedir()]) {
      expect(p.startsWith(root!)).toBe(true);
    }
  });

  it('refuses a path outside the root', () => {
    expect(() => assertHermetic({ DB_PATH: '/Users/x/.arra-oracle-v2/oracle.db' }, '/tmp/r', '/Users/x')).toThrow();
    expect(() => assertHermetic({ DB_PATH: '/tmp/r-evil/oracle.db' }, '/tmp/r', '/Users/x')).toThrow();
    expect(() => assertHermetic({ DB_PATH: '/tmp/r/home/.arra-oracle-v2/oracle.db' }, '/tmp/r', '/Users/x')).not.toThrow();
  });
});
