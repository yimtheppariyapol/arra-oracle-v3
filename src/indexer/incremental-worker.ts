import type Database from 'bun:sqlite';
import type { WorkerEvent, WorkerStats } from './worker.ts';
import { claimNextJobs, markJobDone, markJobError, reclaimStaleJob } from './jobs.ts';
import { writeIncrementalVectors, type IncrementalVectorDeps } from './incremental-vectors.ts';
import { queueVectorTombstones, recoverVectorJobs } from './vector-job-recovery.ts';

export interface IncrementalWorkerDeps {
  db: Database;
  incremental: Omit<IncrementalVectorDeps, 'db' | 'modelKey'> & { collection: string };
  isShuttingDown(): boolean;
  batchSize?: number;
  pollIntervalMs?: number;
  onEvent?(event: WorkerEvent): void;
  /** Failure injection at the actual crash boundary. Throwing leaves claims for restart. */
  afterVectorCommit?(): void;
}

export async function runIncrementalWorker(modelKey: string, deps: IncrementalWorkerDeps): Promise<WorkerStats> {
  const stats: WorkerStats = { modelKey, processed: 0, errors: 0, emptyPolls: 0 };
  const emit = (event: WorkerEvent) => { try { deps.onEvent?.(event); } catch { /* observers cannot ack */ } };
  recoverVectorJobs(deps.db, modelKey, true);
  let lastReconcile = 0;
  while (!deps.isShuttingDown()) {
    if (Date.now() - lastReconcile > 60_000) {
      queueVectorTombstones(deps.db, modelKey, deps.incremental.collection);
      lastReconcile = Date.now();
    }
    recoverVectorJobs(deps.db, modelKey);
    const jobs = claimNextJobs(deps.db, modelKey, deps.batchSize ?? 32);
    if (!jobs.length) {
      stats.emptyPolls++;
      emit({ type: 'idle', modelKey });
      await Bun.sleep(deps.pollIntervalMs ?? 1000);
      continue;
    }
    for (const job of jobs) emit({ type: 'claimed', job });
    const start = performance.now();
    let written: Awaited<ReturnType<typeof writeIncrementalVectors>>;
    try {
      written = await writeIncrementalVectors({ ...deps.incremental, db: deps.db, modelKey },
        [...new Set(jobs.map((job) => job.docId))]);
    } catch (error) {
      for (const job of jobs) {
        const message = error instanceof Error ? error.message : String(error);
        markJobError(deps.db, job.id, message);
        stats.errors++;
        emit({ type: 'error', job, error: message });
      }
      continue;
    }
    // Neither the manifest nor queue can acknowledge uncommitted vector writes.
    deps.afterVectorCommit?.();
    const changed = new Set<string>();
    deps.db.transaction(() => {
      for (const id of written.changedDuringWrite()) changed.add(id);
      written.commit();
      for (const job of jobs) {
        if (changed.has(job.docId)) reclaimStaleJob(deps.db, job.id);
        else markJobDone(deps.db, job.id, written.states.get(job.docId)?.reason ?? null);
      }
    })();
    for (const job of jobs) {
      if (changed.has(job.docId)) continue;
      stats.processed++;
      emit({ type: 'done', job, durationMs: Math.round(performance.now() - start) });
    }
  }
  return stats;
}
