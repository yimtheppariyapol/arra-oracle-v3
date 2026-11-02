import type { Database } from 'bun:sqlite';
import { sqlite as defaultSqlite } from '../db/index.ts';
import { currentTenantId } from '../middleware/tenant.ts';

export type EntityCoverageStats = {
  docsIndexed: number;
  docsWithEntities: number;
  docsMissingEntities: number;
  ratio: number;
  checkedAt: string;
  tenantId?: string;
  error?: string;
};

type CountRow = { count: number };

export function readEntityCoverageStats(
  sqlite: Database = defaultSqlite,
  tenantId = currentTenantId(),
): EntityCoverageStats {
  const checkedAt = new Date().toISOString();
  try {
    if (!tableExists(sqlite, 'oracle_documents') || !tableExists(sqlite, 'oracle_fts')) {
      return stats(0, 0, checkedAt, tenantId);
    }
    if (!tableExists(sqlite, 'oracle_entity_links')) {
      const indexed = indexedCount(sqlite, ftsFilter(sqlite), tenantId);
      return { ...stats(indexed, 0, checkedAt, tenantId), error: 'oracle_entity_links missing' };
    }
    const fts = ftsFilter(sqlite);
    return stats(indexedCount(sqlite, fts, tenantId), linkedCount(sqlite, fts, tenantId), checkedAt, tenantId);
  } catch (error) {
    return { ...stats(0, 0, checkedAt, tenantId), error: message(error) };
  }
}

// /api/health runs these on every request. `oracle_fts.id` is UNINDEXED, so joining on it read the whole
// FTS table: 10 s per call on a 156k-doc vault (2026-11-02), blocking the event loop. The shadow table
// oracle_fts_content carries the same id in c0 and schema.ts indexes it; fall back when the index is absent.
function ftsFilter(sqlite: Database): string {
  const indexed = sqlite.query<CountRow, []>(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_fts_content_doc_id'",
  ).get()?.count;
  return indexed
    ? 'EXISTS (SELECT 1 FROM oracle_fts_content f WHERE f.c0 = d.id)'
    : 'd.id IN (SELECT id FROM oracle_fts)';
}

function indexedCount(sqlite: Database, fts: string, tenantId?: string): number {
  return count(sqlite, `
    SELECT COUNT(*) AS count FROM oracle_documents d
    WHERE ${tenantId ? 'd.tenant_id = ? AND ' : ''}${fts}`, tenantId ? [tenantId] : []);
}

// Driven from documents with EXISTS probes: joining the 1.5M-row link table and de-duplicating took
// 4.8 s on the same vault; one indexed probe per document does not grow with links per document.
function linkedCount(sqlite: Database, fts: string, tenantId?: string): number {
  return count(sqlite, `
    SELECT COUNT(*) AS count FROM oracle_documents d
    WHERE ${tenantId ? 'd.tenant_id = ? AND ' : ''}${fts}
      AND EXISTS (SELECT 1 FROM oracle_entity_links l WHERE l.document_id = d.id AND l.tenant_id = d.tenant_id)`,
  tenantId ? [tenantId] : []);
}

function stats(indexed: number, linked: number, checkedAt: string, tenantId?: string): EntityCoverageStats {
  const docsIndexed = Math.max(0, indexed);
  const docsWithEntities = Math.min(docsIndexed, Math.max(0, linked));
  const docsMissingEntities = Math.max(0, docsIndexed - docsWithEntities);
  return {
    docsIndexed,
    docsWithEntities,
    docsMissingEntities,
    ratio: docsIndexed === 0 ? 1 : round(docsWithEntities / docsIndexed),
    checkedAt,
    ...(tenantId ? { tenantId } : {}),
  };
}

function count(sqlite: Database, sql: string, params: string[]): number {
  return (sqlite.query<CountRow, string[]>(sql).get(...params)?.count ?? 0);
}

function tableExists(sqlite: Database, name: string): boolean {
  return Boolean(sqlite.query<CountRow, [string]>(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = ? LIMIT 1",
  ).get(name)?.count);
}

// /api/health reads coverage on every request (the watchdog polls it every 5 min). Coverage moves slowly,
// and even the indexed form is disk-bound (3.5 s) when the page cache is cold under memory pressure.
const COVERAGE_TTL_MS = 10 * 60_000;
const coverageCache = new Map<string, { at: number; value: EntityCoverageStats }>();
export function cachedEntityCoverageStats(tenantId = currentTenantId(), now = Date.now()): EntityCoverageStats {
  const key = tenantId ?? '';
  const hit = coverageCache.get(key);
  if (hit && now - hit.at < COVERAGE_TTL_MS && !hit.value.error) return hit.value;
  const value = readEntityCoverageStats(defaultSqlite, tenantId);
  coverageCache.set(key, { at: now, value });
  return value;
}

function round(value: number): number { return Number(value.toFixed(4)); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
