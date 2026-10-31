import { enqueueIndexJob } from './jobs.ts';
import { runIncrementalWorker, type IncrementalWorkerDeps } from './incremental-worker.ts';

/** CLI writes use the daemon's claim, acknowledgement, and model-lock protocol. */
export async function runQueuedVectorIndex(
  modelKey: string, ids: string[], deps: Omit<IncrementalWorkerDeps, 'isShuttingDown'>,
) {
  deps.db.transaction(() => {
    for (const docId of new Set(ids)) enqueueIndexJob(deps.db, { docId, modelKey,
      models: { [modelKey]: { collection: deps.incremental.collection } } });
  })();
  let idle = false;
  return runIncrementalWorker(modelKey, { ...deps, isShuttingDown: () => idle,
    onPause: (reason) => { throw new Error(`Vector indexing paused; jobs remain pending: ${reason}`); },
    onEvent: (event) => { if (event.type === 'idle') idle = true; deps.onEvent?.(event); },
  });
}
