/**
 * fts-rowids.ts — map document ids to their oracle_fts rowids without scanning the FTS table.
 *
 * Why: fts5 `id` is UNINDEXED, so deletes filtered by document id and a full
 * `SELECT rowid, id FROM oracle_fts` both read the whole table. Per chunk that was ~0.13s on a
 * 131k-chunk vault (hours for a reindex), and per watcher-stored file it blocked the indexer
 * daemon on startup (2026-11-01, step-5 pilot). The shadow table `oracle_fts_content` shares the
 * fts rowid and carries the id in `c0`, which schema.ts indexes (idx_fts_content_doc_id).
 * Falls back to one full scan when that index is absent (fresh or foreign DBs) so results stay correct.
 * Pairs with: storage.ts storeDocuments, learn-doc-source.ts storeSqliteDocuments.
 */
import type { Database } from 'bun:sqlite';

const CHUNK = 500;

function hasContentIndex(sqlite: Database): boolean {
  const row = sqlite.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'index' AND name = 'idx_fts_content_doc_id'",
  ).get() as { ok: number } | null;
  return Boolean(row);
}

export function ftsRowidsFor(sqlite: Database, ids: Iterable<string>): Map<string, number[]> {
  const wanted = [...new Set(ids)];
  const out = new Map<string, number[]>();
  const add = (id: string, rowid: number) => {
    const list = out.get(id);
    if (list) list.push(rowid);
    else out.set(id, [rowid]);
  };
  if (wanted.length === 0) return out;
  if (hasContentIndex(sqlite)) {
    for (let i = 0; i < wanted.length; i += CHUNK) {
      const slice = wanted.slice(i, i + CHUNK);
      const rows = sqlite.prepare(
        `SELECT id AS rowid, c0 AS id FROM oracle_fts_content WHERE c0 IN (${slice.map(() => '?').join(',')})`,
      ).all(...slice) as { rowid: number; id: string }[];
      for (const row of rows) add(row.id, row.rowid);
    }
    return out;
  }
  const set = new Set(wanted);
  for (const row of sqlite.prepare('SELECT rowid, id FROM oracle_fts').all() as { rowid: number; id: string }[]) {
    if (set.has(row.id)) add(row.id, row.rowid);
  }
  return out;
}
