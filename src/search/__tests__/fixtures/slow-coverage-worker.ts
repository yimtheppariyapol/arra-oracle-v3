import { startEntityCoverageWorker } from '../../entity-coverage-worker-runtime.ts';
import { readEntityCoverageStats } from '../../entity-coverage-reader.ts';

startEntityCoverageWorker((sqlite, tenantId) => {
  Bun.sleepSync(1200);
  // Prove the injected reader receives a readonly connection, even for a no-op write.
  try {
    sqlite.run('UPDATE oracle_documents SET id = id WHERE 0');
    throw new Error('coverage worker unexpectedly allowed a write');
  } catch (error) {
    if (!String(error).includes('readonly')) throw error;
  }
  return readEntityCoverageStats(sqlite, tenantId);
});
