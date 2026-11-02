/**
 * FTS5's document id is UNINDEXED: probing it scans the entire content table and blocks Bun.
 * The content shadow table has the same rowids and an indexed c0 (document id). Read through
 * that index when available, retaining every chunk and LEFT JOIN nulls. Foreign/fresh databases
 * without the index keep the original FTS queries. Only delete through FTS5, never its shadow table.
 */
import type { Database } from 'bun:sqlite';
import { ftsRowidsFor } from '../indexer/fts-rowids.ts';

const indexCache = new WeakMap<Database, { version: number; indexed: boolean }>();
const CHUNK = 500;
export type FtsContent = { id: string; content: string | null; concepts: string | null };

export function hasFtsContentIndex(sqlite: Database): boolean {
  // Schema version invalidates cached absence after db:push, and presence after an index drop.
  const version = (sqlite.query('PRAGMA schema_version').get() as { schema_version: number }).schema_version;
  const hit = indexCache.get(sqlite);
  if (hit?.version === version) return hit.indexed;
  const indexed = Boolean(sqlite.query(
    "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_fts_content_doc_id'",
  ).get());
  indexCache.set(sqlite, { version, indexed });
  return indexed;
}

/** Flattenable subquery exposes the FTS column names, including rowid, without a virtual scan. */
export function ftsSource(sqlite: Database): string {
  return hasFtsContentIndex(sqlite)
    ? '(SELECT id AS rowid, c0 AS id, c1 AS content, c2 AS concepts FROM oracle_fts_content)'
    : 'oracle_fts';
}

/** Caller supplies JOIN or LEFT JOIN; expressions/aliases are trusted SQL, never user input. */
export function ftsJoin(sqlite: Database, documentId = 'd.id', alias = 'f'): string {
  return `${ftsSource(sqlite)} ${alias} ON ${alias}.id = ${documentId}`;
}

export function ftsContentById(sqlite: Database, id: string): FtsContent | null {
  return sqlite.query<FtsContent, [string]>(
    `SELECT id, content, concepts FROM ${ftsSource(sqlite)} WHERE id = ?`,
  ).get(id);
}

/** All chunk rows, in rowid order as in the old full scan; duplicate input ids do not duplicate rows. */
export function ftsContentByIds(sqlite: Database, ids: Iterable<string>): FtsContent[] {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return [];
  const rows: Array<FtsContent & { rowid: number }> = [];
  const source = ftsSource(sqlite);
  if (!hasFtsContentIndex(sqlite)) {
    const ids = new Set(wanted);
    const selected: FtsContent[] = [];
    // One scan even for large batches on foreign databases; retain only requested content.
    for (const row of sqlite.query<FtsContent, []>('SELECT id, content, concepts FROM oracle_fts').iterate()) {
      if (ids.has(row.id)) selected.push(row);
    }
    return selected;
  }
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const batch = wanted.slice(i, i + CHUNK);
    rows.push(...sqlite.query<FtsContent & { rowid: number }, string[]>(
      `SELECT rowid, id, content, concepts FROM ${source} WHERE id IN (${batch.map(() => '?').join(',')})`,
    ).all(...batch));
  }
  return rows.sort((a, b) => a.rowid - b.rowid).map(({ rowid, ...row }) => row);
}

export function deleteFtsById(sqlite: Database, ids: string | Iterable<string>): void {
  const wanted = typeof ids === 'string' ? [ids] : [...ids];
  if (wanted.length === 0) return;
  // Preserve the atomicity of the old single DELETE, including inside callers' transactions.
  sqlite.transaction(() => {
    const rowids = ftsRowidsFor(sqlite, wanted);
    const remove = sqlite.prepare('DELETE FROM oracle_fts WHERE rowid = ?');
    for (const chunks of rowids.values()) for (const rowid of chunks) remove.run(rowid);
  })();
}

/** FTS5 COUNT(*) walks every row; oracle_fts_docsize keeps one small row per FTS row (2.6 s → 0.03 s). */
export function ftsRowCount(sqlite: Database): number {
  const docsize = Boolean(sqlite.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'oracle_fts_docsize'").get());
  const table = docsize ? 'oracle_fts_docsize' : 'oracle_fts';
  return (sqlite.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}
