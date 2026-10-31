import type Database from 'bun:sqlite';
import type { WorkerEvent, WorkerStats } from './worker.ts';
import { claimNextJobs, markJobDone, markJobError, reclaimStaleJob, pauseVectorJob, type EnqueuedJob } from './jobs.ts';
import { writeIncrementalVectors, type IncrementalVectorDeps } from './incremental-vectors.ts';
import { queueVectorTombstones, recoverVectorJobs } from './vector-job-recovery.ts';
import { isTransientVectorError, retrySqliteBusy } from './vector-failures.ts';
import { withFileLock } from '../utils/file-lock.ts';

export interface IncrementalWorkerDeps {
  db: Database;
  incremental: Omit<IncrementalVectorDeps, 'db' | 'modelKey'> & { collection: string };
  isShuttingDown(): boolean;
  batchSize?: number;
  pollIntervalMs?: number;
  force?: boolean;
  onEvent?(event: WorkerEvent): void;
  onPause?(reason: string): void;
  /** Failure injection at the actual crash boundary. Throwing leaves claims for restart. */
  afterVectorCommit?(): void;
}

/** The CLI and daemon share this model writer lock, including restart recovery. */
export async function runIncrementalWorker(modelKey: string, deps: IncrementalWorkerDeps): Promise<WorkerStats> {
  deps.db.exec('PRAGMA busy_timeout = 5000');
  const file = (deps.db.query('PRAGMA database_list').get() as { file: string }).file;
  const run = () => work(modelKey, deps);
  return file ? withFileLock(`${file}.vector-${encodeURIComponent(modelKey)}.lock`, run) : run();
}

async function work(modelKey: string, deps: IncrementalWorkerDeps): Promise<WorkerStats> {
  const stats: WorkerStats = { modelKey, processed: 0, errors: 0, emptyPolls: 0 };
  const emit = (event: WorkerEvent) => { try { deps.onEvent?.(event); } catch { /* observers cannot ack */ } };
  await retrySqliteBusy(() => recoverVectorJobs(deps.db, modelKey, true));
  let lastReconcile = 0;
  let pauses = 0;
  while (!deps.isShuttingDown()) {
    let jobs: EnqueuedJob[] = [];
    try {
      if (Date.now() - lastReconcile > 60_000) {
        const ids = deps.incremental.store.listDocumentIds
          ? await deps.incremental.store.listDocumentIds() : [];
        await retrySqliteBusy(() => queueVectorTombstones(deps.db, modelKey, deps.incremental.collection, ids));
        lastReconcile = Date.now();
      }
      jobs = await retrySqliteBusy(() => {
        recoverVectorJobs(deps.db, modelKey);
        return claimNextJobs(deps.db, modelKey, deps.batchSize ?? 32);
      });
      if (!jobs.length) {
        stats.emptyPolls++;
        emit({ type: 'idle', modelKey });
        await Bun.sleep(deps.pollIntervalMs ?? 1000);
        continue;
      }
      for (const job of jobs) emit({ type: 'claimed', job });
      await processJobs(jobs);
      pauses = 0;
    } catch (error) {
      if (!isTransientVectorError(error)) throw error;
      await retrySqliteBusy(() => deps.db.transaction(() => {
        for (const job of jobs) pauseVectorJob(deps.db, job.id);
      })());
      deps.onPause?.(String(error));
      if (!deps.isShuttingDown()) await Bun.sleep(Math.min(30_000, (deps.pollIntervalMs ?? 1000) * 2 ** Math.min(pauses++, 5)));
    }
  }
  return stats;

  async function processJobs(jobs: EnqueuedJob[]): Promise<void> {
    const start = performance.now();
    let written: Awaited<ReturnType<typeof writeIncrementalVectors>>;
    try {
      written = await writeIncrementalVectors({ ...deps.incremental, db: deps.db, modelKey },
        [...new Set(jobs.map((job) => job.docId))], deps.force);
    } catch (error) {
      if (isTransientVectorError(error)) throw error;
      if (new Set(jobs.map((job) => job.docId)).size > 1) {
        // Bisect failed batches; healthy rows still use batched embedding and writes.
        const mid = Math.ceil(jobs.length / 2);
        await processJobs(jobs.slice(0, mid));
        await processJobs(jobs.slice(mid));
        return;
      }
      await retrySqliteBusy(() => deps.db.transaction(() => {
        for (const job of jobs) markJobError(deps.db, job.id, String(error));
      })());
      for (const job of jobs) { stats.errors++; emit({ type: 'error', job, error: String(error) }); }
      return;
    }
    // Crash injection deliberately remains outside recovery: replay must retain claims.
    deps.afterVectorCommit?.();
    const changed = new Set<string>();
    await retrySqliteBusy(() => deps.db.transaction(() => {
      changed.clear();
      for (const id of written.changedDuringWrite()) changed.add(id);
      written.commit();
      for (const job of jobs) {
        if (changed.has(job.docId)) reclaimStaleJob(deps.db, job.id);
        else markJobDone(deps.db, job.id, written.states.get(job.docId)?.reason ?? null);
      }
    })());
    for (const job of jobs) {
      if (changed.has(job.docId)) continue;
      stats.processed++;
      emit({ type: 'done', job, durationMs: Math.round(performance.now() - start) });
    }
  }
}
