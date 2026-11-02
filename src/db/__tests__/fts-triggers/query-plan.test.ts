import { expect, test } from 'bun:test';
import { all, definitions, fixture, install, oldTriggerSql } from './fixture.ts';
import type { Database } from 'bun:sqlite';

function indexedAccess(db: Database, triggerSql: string, parent: string): boolean {
  const body = triggerSql.match(/\bBEGIN\s+([\s\S]*?);\s*END\s*$/i)?.[1];
  if (!body) throw new Error(`Missing trigger body: ${triggerSql}`);
  const args: string[] = [];
  const dml = body.replace(/\b(?:OLD|NEW)\.(id|concepts)\b/g, (_, field) => {
    args.push(field === 'id' ? 'a' : '["newtoken"]');
    return '?';
  });
  const plan = all<{ detail: string }>(db, `EXPLAIN QUERY PLAN ${dml}`, ...args).map((r) => r.detail);
  const filters = all<{ opcode: string; p4: string | null }>(db, `EXPLAIN ${parent}`, 'a')
    .filter((r) => r.opcode === 'VFilter');
  return plan.some((detail) => /SEARCH oracle_fts_content\b.*\bidx_fts_content_doc_id\b.*\(c0=\?\)/.test(detail))
    && plan.some((detail) => /oracle_fts VIRTUAL TABLE INDEX \d+:=/.test(detail))
    && filters.length > 0 && filters.every((r) => r.p4 === '=');
}

test('both installed triggers replace unconstrained FTS access with indexed rowid access', () => {
  const db = fixture(oldTriggerSql);
  const parents = [
    'UPDATE oracle_documents SET concepts=concepts WHERE id=?',
    'DELETE FROM oracle_documents WHERE id=?',
  ];
  for (const [i, trigger] of definitions(db).entries()) {
    expect(indexedAccess(db, trigger.sql, parents[i])).toBe(false);
  }
  // Fresh prepares in indexedAccess avoid cached diagnostics after trigger replacement.
  install(db);
  expect(definitions(db)).toHaveLength(2);
  for (const [i, trigger] of definitions(db).entries()) {
    expect(indexedAccess(db, trigger.sql, parents[i])).toBe(true);
  }
});
