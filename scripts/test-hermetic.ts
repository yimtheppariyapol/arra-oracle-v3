#!/usr/bin/env bun
/**
 * Run `bun test <args>` with HOME and every ORACLE_* path pointed at a throwaway root FROM PROCESS
 * START. The preload (src/test-setup/hermetic.ts) cannot do this alone: bun resolves
 * os.homedir() once at startup, and named imports (`import { homedir } from 'node:os'`) cannot be
 * patched afterwards, so modules that call homedir() directly would still reach the real home.
 * Plain `bun test` is refused by the preload's guard instead of leaking.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-test-home-'));
const home = path.join(root, 'home');
fs.mkdirSync(home, { recursive: true });

const env: Record<string, string | undefined> = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  ARRA_TEST_ROOT: root,
  ARRA_REAL_HOME: process.env.HOME,
  ORACLE_REPO_ROOT: path.join(root, 'repo'),
};
for (const k of ['ORACLE_DATA_DIR', 'ORACLE_DB_PATH', 'ORACLE_VECTOR_DB_PATH', 'VECTOR_URL', 'XDG_CONFIG_HOME']) delete env[k];

// argv: [bun, this script, ...args for bun test]
const run = Bun.spawnSync([process.execPath, 'test', ...process.argv.slice(2)], {
  env,
  stdio: ['inherit', 'inherit', 'inherit'],
});
fs.rmSync(root, { recursive: true, force: true });
process.exit(run.exitCode ?? 1);
