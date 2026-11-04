import type { Database } from 'bun:sqlite';
import { DB_PATH } from '../config.ts';
import { sqlite as defaultSqlite } from '../db/index.ts';
import { currentTenantId } from '../middleware/tenant.ts';
import { createEntityCoverageCache } from './entity-coverage-cache.ts';
import { readEntityCoverageStats as readCoverage } from './entity-coverage-reader.ts';
export type { EntityCoverageStats } from './entity-coverage-reader.ts';

// Batch jobs keep the synchronous reader. The worker imports the pure reader directly,
// without loading the application's writable default connection or schema initialization.
export function readEntityCoverageStats(sqlite: Database = defaultSqlite, tenantId = currentTenantId()) {
  return readCoverage(sqlite, tenantId);
}

const coverageCache = createEntityCoverageCache({ dbPath: DB_PATH });

// Retain the optional clock argument for callers; requests no longer drive cache expiry.
export function cachedEntityCoverageStats(tenantId = currentTenantId(), _now = Date.now()) {
  return coverageCache.get(tenantId);
}

export function stopEntityCoverageWorker(): void { coverageCache.stop(); }
