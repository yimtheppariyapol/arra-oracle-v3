import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const migrationsFolder = join(import.meta.dir, '../../migrations');
export const replacementSql = readFileSync(join(migrationsFolder, '0043_fts_sync_triggers.sql'), 'utf8');
export const oldTriggerSql = readFileSync(join(migrationsFolder, '0032_schema_integrity_guards.sql'), 'utf8')
  .split('--> statement-breakpoint').filter((sql) => /CREATE TRIGGER IF NOT EXISTS oracle_documents_fts_/.test(sql))
  .join('\n');
export const triggerNames = ['oracle_documents_fts_delete_sync', 'oracle_documents_fts_concepts_sync'];
const opened: Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

export function memoryDb(): Database {
  const db = new Database(':memory:');
  opened.push(db);
  return db;
}

export function all<T = Record<string, unknown>>(db: Database, sql: string, ...args: SQLQueryBindings[]): T[] {
  const statement = db.prepare<T, SQLQueryBindings[]>(sql);
  try { return statement.all(...args); } finally { statement.finalize(); }
}

export function run(db: Database, sql: string, ...args: SQLQueryBindings[]) {
  const statement = db.prepare(sql);
  try { return statement.run(...args); } finally { statement.finalize(); }
}

export function install(db: Database, sql = replacementSql) {
  for (const name of triggerNames) db.exec(`DROP TRIGGER IF EXISTS ${name}`);
  db.exec(sql);
}

export function fixture(sql = replacementSql): Database {
  const db = memoryDb();
  db.exec(`CREATE TABLE oracle_documents (id TEXT PRIMARY KEY, concepts TEXT);
    CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts);
    CREATE INDEX idx_fts_content_doc_id ON oracle_fts_content(c0);`);
  install(db, sql);
  for (const [id, concepts] of [['a', '["oldtoken"]'], ['b', '["retainedconcept"]'],
    ['!?/::', '["punctconcept"]'], ['missing', null]]) {
    run(db, 'INSERT INTO oracle_documents VALUES (?, ?)', id, concepts);
  }
  for (const row of [
    ['a', 'contenttoken first chunk', 'oldtoken'],
    ['b', 'retainedword', 'retainedconcept'],
    ['a', 'contenttoken second chunk', 'oldtoken'],
    ['!?/::', 'punctword', 'punctconcept'],
  ]) run(db, 'INSERT INTO oracle_fts VALUES (?, ?, ?)', ...row);
  return db;
}

export type FtsRow = { rowid: number; id: string; content: string; concepts: string | null };
export const rows = (db: Database) => all<FtsRow>(db,
  'SELECT rowid, id, content, concepts FROM oracle_fts ORDER BY rowid');
export const hits = (db: Database, term: string) => all<{ rowid: number; id: string }>(db,
  'SELECT rowid, id FROM oracle_fts WHERE oracle_fts MATCH ? ORDER BY rowid', term);
export const metadata = (db: Database) => all(db, 'SELECT * FROM oracle_documents ORDER BY id');
export const integrity = (db: Database) => db.exec("INSERT INTO oracle_fts(oracle_fts) VALUES ('integrity-check')");
export const definitions = (db: Database) => all<{ name: string; sql: string }>(db,
  "SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'oracle_documents_fts_%' ORDER BY name");
