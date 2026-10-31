/**
 * arra-indexer daemon entrypoint — Elysia (M3, ported from alpha's Hono).
 *
 * Wires the real adapters (SQLite db, OllamaEmbeddings, LanceDB) into the
 * pure M2 worker loop, exposes the M3 HTTP API as an Elysia plugin, and
 * handles graceful shutdown on SIGTERM/SIGINT.
 *
 * Run:
 *   bun src/indexer/daemon.ts
 *
 * Listens on 127.0.0.1:47779 by default (override via INDEXER_PORT env).
 *
 * Design: ψ/lab/indexer-cli/DESIGN.md
 */

import { Elysia } from 'elysia';
import { DB_PATH, REPO_ROOT, ORACLE_DATA_DIR } from '../config.ts';
import { createDatabase } from '../db/index.ts';
import { createVectorStoreForModel, getEmbeddingModels } from '../vector/factory.ts';
import { runWorker, type WorkerEvent } from './worker.ts';
import { join } from 'node:path';
import { EmbeddingCache } from '../vector/embedding-cache.ts';
import type { EmbeddingProvider } from '../vector/types.ts';
import { productionVectorModels, vectorEligibilityConfig } from './vector-eligibility.ts';
import { daemonApiPlugin, makeEventBus } from '../routes/indexer-daemon/index.ts';
import { startLearnWatcher, type StopWatch } from './learn-watcher.ts';

const PORT = parseInt(process.env.INDEXER_PORT || '47779', 10);
const HOST = process.env.INDEXER_HOST || '127.0.0.1';

export async function startDaemon(): Promise<void> {
  const { sqlite, storage } = createDatabase(DB_PATH);
  // Ensure WAL so concurrent readers (arra-oracle-v3) don't block writes.
  sqlite.exec('PRAGMA journal_mode = WAL');

  const models = productionVectorModels(getEmbeddingModels(), vectorEligibilityConfig(process.env));
  const cache = new EmbeddingCache(join(ORACLE_DATA_DIR, 'embedding-cache'));
  const eventBus = makeEventBus<WorkerEvent>();
  let shuttingDown = false;
  let stopLearnWatcher: StopWatch | undefined;

  // Embed via the existing factory — produces a model-aware OllamaEmbeddings.
  // Lazy per model so we don't spin up unused embedders.
  const stores = new Map<string, ReturnType<typeof createVectorStoreForModel>>();
  const getStore = async (modelKey: string) => {
    let s = stores.get(modelKey);
    if (!s) {
      const preset = models[modelKey];
      if (!preset) throw new Error(`Unknown model_key: ${modelKey}`);
      s = createVectorStoreForModel(preset);
      await s.connect();
      await s.ensureCollection();
      stores.set(modelKey, s);
    }
    return s;
  };

  const workerPromises: Promise<unknown>[] = [];
  const startWorkers: Array<() => Promise<unknown>> = [];
  for (const modelKey of Object.keys(models)) {
    const store = await getStore(modelKey);
    const embedder = (store as unknown as { embedder: EmbeddingProvider }).embedder;
    if (!embedder) throw new Error(`No embedder on store for ${modelKey}`);
    startWorkers.push(() => runWorker(modelKey, {
      db: sqlite,
      incremental: { store, embedder, cache, collection: models[modelKey].collection },
      batchSize: Number(process.env.ORACLE_INDEXER_BATCH_SIZE || 32),
      isShuttingDown: () => shuttingDown,
      onEvent: eventBus.publish,
      pollIntervalMs: 1000,
    }));
    console.log(`[arra-indexer] worker started for model: ${modelKey}`);
  }

  const app = new Elysia()
    .onError(({ error, set }) => {
      const msg = (error as { message?: string })?.message ?? String(error);
      set.status = 500;
      return { error: msg };
    })
    .use(
      daemonApiPlugin({
        db: sqlite,
        models,
        isShuttingDown: () => shuttingDown,
        requestShutdown: () => { shuttingDown = true; },
        subscribe: eventBus.subscribe,
      }),
    )
    .listen({ hostname: HOST, port: PORT });

  for (const start of startWorkers) workerPromises.push(start());

  console.log(`[arra-indexer] listening on http://${HOST}:${PORT}`);
  console.log(`[arra-indexer] models: ${Object.keys(models).join(', ')}`);

  stopLearnWatcher = startLearnWatcher({
    db: sqlite,
    models,
    repoRoot: REPO_ROOT,
  });

  const shutdown = async (signal: string) => {
    console.log(`[arra-indexer] ${signal} — draining…`);
    shuttingDown = true;
    stopLearnWatcher?.();
    stopLearnWatcher = undefined;
    await app.stop();
    // Workers exit on next loop tick. Give them up to 5s of in-flight grace.
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
    await Promise.race([Promise.all(workerPromises), timeout]);
    storage.close();
    console.log(`[arra-indexer] stopped.`);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (import.meta.main) {
  startDaemon().catch((err) => {
    console.error('[arra-indexer] fatal:', err);
    process.exit(1);
  });
}
