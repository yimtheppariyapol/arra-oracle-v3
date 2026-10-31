#!/usr/bin/env bun
/** Generic embedding model indexer with incremental chunk-hash support. */

import { createVectorStoreForModel, EMBEDDING_MODELS } from '../vector/factory.ts';
import { createDatabase, oracleDocuments } from '../db/index.ts';
import { count } from 'drizzle-orm';
import { DB_PATH } from '../config.ts';
import { formatIndexProgress, normalizeBatchSize } from './indexer-progress.ts';
import { loadVectorIndexManifest, planVectorIndex, type VectorIndexPlan } from '../indexer/vector-index-manifest.ts';
import { readVectorDocuments } from '../indexer/vector-documents.ts';
import { runQueuedVectorIndex } from '../indexer/queued-vector-index.ts';
import { EmbeddingCache } from '../vector/embedding-cache.ts';
import type { EmbeddingProvider } from '../vector/types.ts';
import { ORACLE_DATA_DIR } from '../config.ts';
import { join } from 'node:path';

const args = process.argv.slice(2);
const modelKey = args.find((arg) => !arg.startsWith('--'));
const flags = new Set(args.filter((arg) => arg.startsWith('--')));

if (!modelKey || !EMBEDDING_MODELS[modelKey] || flags.has('--help')) {
  console.error('Usage: bun src/scripts/index-model.ts <model> [--incremental] [--dry-run] [--force]');
  console.error(`Available models: ${Object.keys(EMBEDDING_MODELS).join(', ')}`);
  process.exit(flags.has('--help') ? 0 : 1);
}

const selectedModelKey = modelKey;
const preset = EMBEDDING_MODELS[selectedModelKey];
const BATCH_SIZE = normalizeBatchSize(process.env.ORACLE_EMBED_BATCH_SIZE, 50);
const dryRun = flags.has('--dry-run');
const force = flags.has('--force');

async function main() {
  console.log(`=== ${selectedModelKey} Indexer ===`);
  console.log(`DB: ${DB_PATH}`);
  console.log(`Collection: ${preset.collection}`);
  console.log(`Model: ${preset.model}`);
  console.log(`Adapter: ${preset.adapter || 'sqlite-vec'}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Mode: ${force ? 'force rebuild' : 'incremental'}${dryRun ? ' dry-run' : ''}`);

  const { db, sqlite } = createDatabase(DB_PATH);
  const [{ total: docCount }] = db.select({ total: count() }).from(oracleDocuments).all();
  const states = readVectorDocuments(db);
  const docs = [...states.values()].flatMap((state) => state.doc ? [state.doc] : []);
  const previous = loadVectorIndexManifest(db, selectedModelKey);
  const plan = planVectorIndex(docs, previous, selectedModelKey, { force });
  const startTime = Date.now();

  console.log(`Documents: ${docCount}`);
  console.log(`Chunks: ${plan.total}; stale: ${plan.staleIds.length}`);

  if (dryRun) {
    console.log('Dry run leaves the model digest unresolved; embedding/cache counts are unknown.');
    printSummary(docs, plan, { embedded: null, errors: 0, startTime, dryRun, force });
    sqlite.close();
    return;
  }

  const store = createVectorStoreForModel(preset);
  await store.connect();

  try {
    const embedder = (store as unknown as { embedder: EmbeddingProvider }).embedder;
    const cache = new EmbeddingCache(join(ORACLE_DATA_DIR, 'embedding-cache'));
    // Include prior ids so deleted/superseded chunks become tombstones. Force rebuilds
    // still use cached embeddings and never drop the shared table.
    const ids = [...new Set([...docs.map((doc) => doc.id), ...previous.keys()])];
    let completed = 0;
    const stats = await runQueuedVectorIndex(selectedModelKey, ids, {
      db: sqlite, incremental: { store, embedder, cache, collection: preset.collection },
      batchSize: BATCH_SIZE, force, pollIntervalMs: 1,
      onEvent: (event) => { if (event.type === 'done') logProgress('Stored', ++completed, ids.length, startTime); },
    });
    printSummary(docs, plan, { embedded: null, errors: stats.errors, startTime, dryRun, force });
    if (stats.errors) throw new Error(`${stats.errors} vector job(s) failed; inspect indexing_jobs`);
  } finally {
    await store.close();
    sqlite.close();
  }
}

function logProgress(label: string, indexed: number, total: number, startTime: number): void {
  const progress = formatIndexProgress({ indexed, total, startTimeMs: startTime });
  console.log(`  ${label} ${indexed}/${total} chunks — ${progress.rate}/s — ETA ${progress.eta}s`);
}

function printSummary(
  rows: import('../vector/types.ts').VectorDocument[],
  plan: VectorIndexPlan,
  result: { embedded: number | null; errors: number; startTime: number; dryRun: boolean; force: boolean },
): void {
  const durationMs = Date.now() - result.startTime;
  const summary = {
    scanned_files: new Set(rows.map((row) => row.metadata.source_file)).size,
    total_chunks: plan.total,
    skipped: result.dryRun ? null : plan.skipped,
    embedded: result.embedded,
    deleted: plan.staleIds.length,
    errors: result.errors,
    dry_run: result.dryRun,
    force: result.force,
    duration_ms: durationMs,
  };
  console.log('\n=== Done ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(e => {
  console.error('Indexer failed:', e);
  process.exit(1);
});
