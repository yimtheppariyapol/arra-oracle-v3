/**
 * Test preload (bunfig.toml [test] preload): point every path the server derives from HOME and
 * ORACLE_* at a throwaway root BEFORE any test file imports config.ts, and refuse to run if
 * anything still resolves outside it.
 *
 * Why (2026-09-11): `bun run test:unit` on the machine running the live server wrote a fixture
 * vector-server.json and a peer-key.hex into the real ~/.arra-oracle-v2 and backed up the real
 * oracle.db six times. config.ts freezes ORACLE_DATA_DIR at first import, and `isolate = true`
 * does not give each test file its own module registry on bun 1.3.11 (decoy: a file that sets the
 * env and then dynamic-imports a module still sees the value an earlier file froze). The live
 * server kept the old config in memory, then returned 500 (`preset.adapter`) on its next restart.
 *
 * HOME itself must be set before bun starts (os.homedir() is resolved once at startup), so the
 * package.json test scripts go through scripts/test-hermetic.ts. Run `bun test` directly and the
 * guard below refuses, because os.homedir() is still the real home.
 *
 * No switch to turn this off. ARRA_TEST_ROOT is only accepted when it is a fresh
 * `arra-test-home-*` directory under the OS temp dir, so it cannot be pointed at real data.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertHermetic } from './assert-hermetic.ts';

const realHome = process.env.ARRA_REAL_HOME || process.env.HOME || os.homedir();
const tmp = path.resolve(os.tmpdir()) + path.sep;
const preset = process.env.ARRA_TEST_ROOT;
const presetOk = !!preset && path.resolve(preset).startsWith(tmp)
  && path.basename(preset).startsWith('arra-test-home-') && fs.existsSync(preset);
if (preset && !presetOk) {
  throw new Error(`hermetic test setup: ARRA_TEST_ROOT=${preset} is not an arra-test-home-* directory under ${tmp}`);
}
const root = presetOk ? preset! : fs.mkdtempSync(path.join(os.tmpdir(), 'arra-test-home-'));
const home = path.join(root, 'home');
fs.mkdirSync(home, { recursive: true });

for (const k of ['ORACLE_DATA_DIR', 'ORACLE_DB_PATH', 'ORACLE_VECTOR_DB_PATH', 'VECTOR_URL', 'XDG_CONFIG_HOME']) {
  delete process.env[k];
}
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.ORACLE_REPO_ROOT = path.join(root, 'repo');
process.env.ARRA_TEST_ROOT = root;

const cfg = await import('../config.ts');
assertHermetic(
  {
    ORACLE_DATA_DIR: cfg.ORACLE_DATA_DIR,
    DB_PATH: cfg.DB_PATH,
    REPO_ROOT: cfg.REPO_ROOT,
    LANCEDB_DIR: cfg.LANCEDB_DIR,
    VECTORS_DB_PATH: cfg.VECTORS_DB_PATH,
    CHROMADB_DIR: cfg.CHROMADB_DIR,
    homedir: os.homedir(),
  },
  root,
  realHome,
  'Run tests through `bun run test:unit` (scripts/test-hermetic.ts), which sets HOME before bun starts.',
);
