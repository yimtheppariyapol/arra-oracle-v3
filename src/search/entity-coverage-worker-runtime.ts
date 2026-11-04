import { Database } from 'bun:sqlite';
import { readEntityCoverageStats, type EntityCoverageStats } from './entity-coverage-reader.ts';
import { pendingEntityCoverage, type CoverageRequest, type CoverageResult } from './entity-coverage-cache.ts';

declare const self: Worker;

// Reader injection is used by the slow-reader regression fixture; production always uses SQL.
export function startEntityCoverageWorker(read = readEntityCoverageStats): void {
  self.onmessage = (event: MessageEvent<CoverageRequest>) => {
    const { dbPath, tenantId } = event.data;
    let sqlite: Database | undefined;
    let value: EntityCoverageStats;
    try {
      if (dbPath === ':memory:' || !dbPath) throw new Error('entity coverage requires a shared database file');
      sqlite = new Database(dbPath, { readonly: true });
      value = read(sqlite, tenantId);
    } catch (error) {
      const { pending, ...empty } = pendingEntityCoverage(tenantId);
      value = { ...empty, error: error instanceof Error ? error.message : String(error) };
    } finally {
      sqlite?.close();
    }
    self.postMessage({ tenantId, value } satisfies CoverageResult);
  };
}
