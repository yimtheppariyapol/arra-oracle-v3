import { afterEach, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeDrizzleSqlite } from '../../../storage/drizzle-sqlite.ts';
import * as schema from '../../schema.ts';
import { all, definitions, hits, integrity, memoryDb, metadata, migrationsFolder, replacementSql, rows, run } from './fixture.ts';
import type { Database } from 'bun:sqlite';

const timestamp = 1793577600000;
const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true }); });

function migrationFolder(through: number, failure = false) {
  const dir = mkdtempSync(join(tmpdir(), 'fts-trigger-migrations-'));
  temporary.push(dir);
  mkdirSync(join(dir, 'meta'));
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= through);
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) {
    const filename = `${entry.tag}.sql`;
    let sql = readFileSync(join(migrationsFolder, filename), 'utf8');
    if (entry.idx === 43 && failure) {
      sql = sql.replace('--> statement-breakpoint', '--> statement-breakpoint\nSELECT injected_migration_failure();\n--> statement-breakpoint');
    }
    writeFileSync(join(dir, filename), sql);
  }
  return dir;
}

const ledger = (db: Database) => all(db, 'SELECT * FROM __drizzle_migrations ORDER BY id');
const guards = (db: Database) => all<{ name: string; sql: string }>(db,
  "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'oracle_documents_%_guard' ORDER BY name");

function seed(db: Database) {
  for (const id of ['a', 'b']) run(db, `INSERT INTO oracle_documents
    (id, type, source_file, concepts, created_at, updated_at, indexed_at)
    VALUES (?, 'learning', 'fixture.md', '["oldtoken"]', 1, 1, 1)`, id);
  for (const row of [['a', 'contenttoken first', 'oldtoken'], ['b', 'retainedword', 'oldtoken'],
    ['a', 'contenttoken second', 'oldtoken']]) run(db, 'INSERT INTO oracle_fts VALUES (?, ?, ?)', ...row);
}

function verifyInstalled(db: Database) {
  const installed = definitions(db);
  expect(installed).toHaveLength(2);
  for (const trigger of installed) {
    const expected = replacementSql.split('--> statement-breakpoint')
      .find((sql) => sql.includes(`CREATE TRIGGER ${trigger.name}\n`))!;
    const normalize = (sql: string) => sql.trim().replace(/;$/, '').replace(/\s+/g, ' ');
    expect(normalize(trigger.sql)).toBe(normalize(expected));
  }
  expect(all(db, "PRAGMA index_info('idx_fts_content_doc_id')").map((r) => r.name)).toEqual(['c0']);
  expect(all(db, "SELECT tbl_name FROM sqlite_master WHERE type='index' AND name='idx_fts_content_doc_id'"))
    .toEqual([{ tbl_name: 'oracle_fts_content' }]);
  expect(all(db, 'SELECT created_at FROM __drizzle_migrations WHERE created_at=?', timestamp))
    .toEqual([{ created_at: timestamp }]);
  expect(guards(db)).toHaveLength(4);
  integrity(db);
}

test('fresh full Drizzle migration installs definitions, index and one ledger row; rerun is a no-op', () => {
  const db = memoryDb();
  migrate(drizzle(db), { migrationsFolder });
  seed(db);
  verifyInstalled(db);
  const before = { ledger: ledger(db), metadata: metadata(db), rows: rows(db) };
  migrate(drizzle(db), { migrationsFolder });
  expect({ ledger: ledger(db), metadata: metadata(db), rows: rows(db) }).toEqual(before);
  verifyInstalled(db);
});

for (const missingIndex of [false, true]) {
  test(`upgrade seeded through-0042 preserves data and guards (missing index: ${missingIndex})`, () => {
    const db = memoryDb();
    migrate(drizzle(db), { migrationsFolder: migrationFolder(42) });
    seed(db);
    const before = { metadata: metadata(db), rows: rows(db), guards: guards(db), ledger: ledger(db) };
    if (missingIndex) db.exec('DROP INDEX idx_fts_content_doc_id');
    migrate(drizzle(db), { migrationsFolder });
    expect(metadata(db)).toEqual(before.metadata);
    expect(rows(db)).toEqual(before.rows);
    expect(guards(db)).toEqual(before.guards);
    expect(ledger(db).slice(0, -1)).toEqual(before.ledger);
    expect(ledger(db)).toHaveLength(before.ledger.length + 1);
    verifyInstalled(db);
    run(db, 'UPDATE oracle_documents SET concepts=? WHERE id=?', '["newtoken"]', 'a');
    expect(hits(db, 'newtoken')).toEqual(hits(db, 'contenttoken'));
    run(db, 'DELETE FROM oracle_documents WHERE id=?', 'a');
    expect(hits(db, 'contenttoken')).toEqual([]);
    expect(hits(db, 'retainedword')).toHaveLength(1);
    const applied = ledger(db);
    migrate(drizzle(db), { migrationsFolder });
    expect(ledger(db)).toEqual(applied);
    integrity(db);
  });
}

test('Drizzle failure after DROP rolls back old trigger definitions and migration ledger together', () => {
  const db = memoryDb();
  migrate(drizzle(db), { migrationsFolder: migrationFolder(42) });
  seed(db);
  const before = { triggers: definitions(db), ledger: ledger(db), metadata: metadata(db), rows: rows(db) };
  expect(() => migrate(drizzle(db), { migrationsFolder: migrationFolder(43, true) })).toThrow();
  expect(db.inTransaction).toBe(false);
  expect({ triggers: definitions(db), ledger: ledger(db), metadata: metadata(db), rows: rows(db) }).toEqual(before);
  const total = () => all<{ n: number }>(db, 'SELECT total_changes() AS n')[0].n;
  const count = total();
  run(db, 'UPDATE oracle_documents SET concepts=concepts WHERE id=?', 'a');
  expect(total() - count).toBeGreaterThan(1);
  integrity(db);
});

test('actual initialization and additive repair wrapper upgrades 0042, repairs the index and reruns safely', () => {
  const db = memoryDb();
  migrate(drizzle(db), { migrationsFolder: migrationFolder(42) });
  seed(db);
  db.exec('DROP INDEX idx_fts_content_doc_id');
  // Existing additive drift is repaired before the unsupported DROP migration is left to migrate().
  run(db, 'DELETE FROM __drizzle_migrations WHERE created_at=?', 1781628166154);
  const before = { metadata: metadata(db), rows: rows(db), guards: guards(db) };
  initializeDrizzleSqlite(drizzle(db, { schema }), db);
  expect({ metadata: metadata(db), rows: rows(db), guards: guards(db) }).toEqual(before);
  expect(all(db, 'SELECT created_at FROM __drizzle_migrations WHERE created_at=?', 1781628166154))
    .toHaveLength(1);
  verifyInstalled(db);
  const applied = ledger(db);
  initializeDrizzleSqlite(drizzle(db, { schema }), db);
  expect(ledger(db)).toEqual(applied);
  verifyInstalled(db);
});
