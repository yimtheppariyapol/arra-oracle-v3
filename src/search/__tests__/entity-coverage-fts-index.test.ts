/**
 * Entity coverage must not scan the FTS table.
 *
 * /api/health calls readEntityCoverageStats on every request. It joined `oracle_fts` on `id`, which is
 * UNINDEXED in FTS5, so each call read the whole FTS table: 10 s on a 156k-doc / 1.8 GB vault
 * (2026-11-02), synchronously on the event loop. Under memory pressure the server stopped answering
 * at all and the watchdog spawned a doomed second server every 5 minutes.
 * This pins: same counts as the FTS join, and no `VIRTUAL TABLE` scan when idx_fts_content_doc_id exists.
 */

import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readEntityCoverageStats } from '../entity-coverage.ts';

function vault(withIndex: boolean): Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE oracle_documents (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default');
    CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts);
    CREATE TABLE oracle_entity_links (document_id TEXT, tenant_id TEXT, entity_key TEXT);
  `);
  if (withIndex) db.exec('CREATE INDEX idx_fts_content_doc_id ON oracle_fts_content (c0)');
  for (let i = 0; i < 20; i++) {
    db.run('INSERT INTO oracle_documents (id) VALUES (?)', [`d${i}`]);
    if (i < 15) db.run('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)', [`d${i}`, `text ${i}`, '']);
    if (i < 15 && i % 3 === 0) db.run("INSERT INTO oracle_entity_links VALUES (?, 'default', 'k')", [`d${i}`]);
  }
  // a chunk row: two FTS rows for one document must still count the document once
  db.run('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)', ['d0', 'second chunk', '']);
  return db;
}

/** Runs the coverage read on `db` and returns the query plan of each count query it issued. */
function coveragePlans(db: Database): string[] {
  const sqls: string[] = [];
  const query = db.query.bind(db);
  (db as any).query = (sql: string) => { sqls.push(sql); return query(sql); };
  readEntityCoverageStats(db, undefined);
  (db as any).query = query;
  const counting = sqls.filter((s) => s.includes('FROM oracle_documents d'));
  return counting.map((s) => {
    const rows = db.query('EXPLAIN QUERY PLAN ' + s).all() as { detail: string }[];
    return rows.map((r) => r.detail).join(' | ');
  });
}

describe('readEntityCoverageStats', () => {
  it('counts the same with and without the content index', () => {
    const a = readEntityCoverageStats(vault(true), undefined);
    const b = readEntityCoverageStats(vault(false), undefined);
    expect([a.docsIndexed, a.docsWithEntities]).toEqual([15, 5]);
    expect([b.docsIndexed, b.docsWithEntities]).toEqual([15, 5]);
  });

  it('uses idx_fts_content_doc_id instead of scanning the FTS table', () => {
    const plans = coveragePlans(vault(true));
    expect(plans.length).toBe(2);
    for (const plan of plans) {
      expect(plan).not.toContain('VIRTUAL TABLE');
      expect(plan).toContain('idx_fts_content_doc_id');
    }
  });
});
