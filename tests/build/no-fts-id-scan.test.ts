/**
 * Non-MATCH probes on the FTS5 UNINDEXED document id must go through fts-lookup.ts, and row counts
 * must not run on the FTS5 table itself: `COUNT(*) FROM oracle_fts` walks every row (2.6 s on the
 * 156k-doc vault, on every /api/health call, 2026-11-02); `oracle_fts_docsize` has one row per FTS row.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { violations } from './fts-scan-inspection.ts';

const root = join(import.meta.dir, '../..');

test('source contains no non-MATCH FTS document-id scans', () => {
  const failures: string[] = [];
  for (const file of [...new Bun.Glob('**/*.ts').scanSync({ cwd: join(root, 'src') })].sort()) {
    if (file.includes('__tests__/') || file.endsWith('.test.ts') || file.startsWith('db/migrations/')) continue;
    for (const line of violations(readFileSync(join(root, 'src', file), 'utf8'))) failures.push(`src/${file}:${line}`);
  }
  expect(failures).toEqual([]);
});

test('new migrations contain no non-MATCH FTS document-id scans, including unjournaled files', () => {
  const failures: string[] = [];
  const directory = join(root, 'src/db/migrations');
  for (const file of [...new Bun.Glob('*.sql').scanSync({ cwd: directory })].sort()) {
    const prefix = file.match(/^(\d+)_/);
    if (!prefix || Number(prefix[1]) <= 42) continue;
    for (const line of violations(readFileSync(join(directory, file), 'utf8'), true)) {
      failures.push(`src/db/migrations/${file}:${line}`);
    }
  }
  expect(failures).toEqual([]);
});

test('guard detects both join directions, direct reads/deletes, FTS row counts, and leaves MATCH alone', () => {
  for (const sql of [
    'SELECT f.content FROM docs d JOIN oracle_fts f ON f.id = d.id',
    'SELECT f.content FROM docs d LEFT JOIN oracle_fts f ON d.id = f.id',
    'SELECT f.content FROM oracle_fts f JOIN docs d ON d.id = f.id',
    'SELECT content FROM oracle_fts WHERE id IN (?)',
    'DELETE FROM oracle_fts WHERE id = ?',
    'SELECT COUNT(*) AS c FROM oracle_fts',
  ]) expect(violations(`const query = \`${sql}\`;`)).toEqual([1]);
  expect(violations('const q = `SELECT f.id FROM oracle_fts f JOIN docs d ON f.id = d.id WHERE oracle_fts MATCH ?`;')).toEqual([]);
  expect(violations("const n = count('oracle_fts');")).toEqual([1]);
  expect(violations('const q = `SELECT COUNT(*) AS c FROM oracle_fts_docsize`;')).toEqual([]);
  expect(violations('const q = eq(oracleFts.id, id);')).toEqual([1]);
  expect(violations('const q = inArray(oracleFts.id, ids);')).toEqual([1]);
});

test('SQL guard detects old triggers, aliases, multiline updates and preserves comment line offsets', () => {
  const old = readFileSync(join(root, 'src/db/migrations/0032_schema_integrity_guards.sql'), 'utf8');
  const bodies = old.split('--> statement-breakpoint').filter((sql) => /CREATE TRIGGER IF NOT EXISTS oracle_documents_fts_/.test(sql));
  expect(bodies).toHaveLength(2);
  for (const body of bodies) expect(violations(body, true)).toHaveLength(1);
  for (const sql of [
    'UPDATE oracle_fts SET concepts = NEW.concepts WHERE id = NEW.id',
    'UPDATE oracle_fts AS f SET concepts=? WHERE f.id IN (?)',
    'UPDATE\n oracle_fts\n SET concepts=?\n WHERE id=?',
    'DELETE FROM oracle_fts AS f WHERE f.id=?',
    'SELECT * FROM oracle_fts AS f WHERE ? = f.id',
    'CREATE TRIGGER t AFTER UPDATE ON docs BEGIN UPDATE oracle_fts SET concepts=? WHERE id=NEW.id; END;',
  ]) {
    expect(violations(sql, true)).toHaveLength(1);
    expect(violations(`const q = \`${sql}\`;`)).toHaveLength(1);
  }
  expect(violations('-- UPDATE oracle_fts SET concepts=? WHERE id=?;\n/* ignored\n DELETE FROM oracle_fts WHERE id=?; */\nUPDATE /* target */ oracle_fts SET concepts=? WHERE id=?;', true)).toEqual([4]);
  expect(violations('const q = `-- ignored\nUPDATE oracle_fts SET concepts=? WHERE id=?`;')).toEqual([2]);
  expect(violations('/* UPDATE oracle_fts SET concepts=? WHERE id=? */', true)).toEqual([]);
  expect(violations('const q = `SELECT * FROM oracle_fts WHERE oracle_fts MATCH ?;\nUPDATE oracle_fts SET concepts=? WHERE id=?`;')).toEqual([2]);
  expect(violations("SELECT * FROM oracle_fts WHERE content='oracle_fts MATCH ;';\nUPDATE oracle_fts SET concepts=? WHERE id=?;", true)).toEqual([2]);
  expect(violations('-- oracle_fts MATCH ?\nDELETE FROM oracle_fts WHERE id=?;', true)).toEqual([2]);
});

test('rowid-IN-shadow trigger queries pass in SQL and TypeScript', () => {
  for (const verb of ['DELETE FROM oracle_fts', 'UPDATE oracle_fts SET concepts=NEW.concepts']) {
    const sql = `${verb} WHERE rowid IN (SELECT id FROM oracle_fts_content WHERE c0=NEW.id);`;
    expect(violations(sql, true)).toEqual([]);
    expect(violations(`const q = \`${sql}\`;`)).toEqual([]);
  }
});
