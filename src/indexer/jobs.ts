/**
 * Indexer job-queue helpers — M1 of the indexer-CLI design.
 *
 * Synchronous Drizzle operations against the `indexing_jobs` table. No
 * embedding, no Ollama, no LanceDB. Just queue plumbing — the daemon
 * (M2) is what does the actual work.
 *
 * Plug-and-play invariants:
 *   - One row per (doc_id, model_key) — adding a model adds queue entries,
 *     never touches oracle_documents or other models' collections
 *   - claimNextJob() is atomic via UPDATE...RETURNING with WHERE status filter
 *   - markJobError() preserves the row (no destruction); attempts increments
 *
 * Design rationale: ψ/lab/indexer-cli/DESIGN.md in arra-mcp-installation-guide-oracle
 */

import type Database from 'bun:sqlite';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.ts';
import { indexingJobs } from '../db/schema.ts';

export interface EnqueueOptions {
  docId: string;
  /** If omitted → enqueue for ALL models in the registry (typical oracle_learn case). */
  modelKey?: string;
  /** Registry of model_key → collection. Caller passes this in (no global state). */
  models: Record<string, { collection: string }>;
}

export interface EnqueuedJob {
  id: string;
  docId: string;
  modelKey: string;
  collection: string;
}

const RANDOM_SUFFIX_LENGTH = 6;
type JobsDb = Database | BunSQLiteDatabase<typeof schema>;

function jobId(modelKey: string): string {
  // "idx-<ms>-<modelKey>-<rand>" — short, sortable, unique enough for our scale.
  const safe = modelKey.replace(/[^a-z0-9]/gi, '');
  const rand = Math.random().toString(36).slice(2, 2 + RANDOM_SUFFIX_LENGTH);
  return `idx-${Date.now()}-${safe}-${rand}`;
}

function asDrizzle(conn: JobsDb): BunSQLiteDatabase<typeof schema> {
  if ('select' in conn && typeof conn.select === 'function') {
    return conn as BunSQLiteDatabase<typeof schema>;
  }
  return drizzle(conn as Database, { schema });
}

/**
 * Insert one or more job rows. Returns the rows that were inserted.
 *
 * For unset `modelKey`, inserts one row per entry in `models`. For a specified
 * `modelKey` not in `models`, returns [] (nothing to enqueue — caller's choice
 * to fail loudly or silently).
 */
export function enqueueIndexJob(conn: JobsDb, opts: EnqueueOptions): EnqueuedJob[] {
  const targets: Array<{ key: string; collection: string }> = opts.modelKey
    ? opts.models[opts.modelKey]
      ? [{ key: opts.modelKey, collection: opts.models[opts.modelKey].collection }]
      : []
    : Object.entries(opts.models).map(([key, { collection }]) => ({ key, collection }));
  // Single choke point for every enqueue path (learn tool, file watcher, indexer). When the
  // production model set is pinned, other registry models get no jobs: 70 stray nomic/qwen3 jobs
  // appeared during the 2026-11-01 pilot from callers passing the full registry.
  const pinned = process.env.ORACLE_VECTOR_MODELS?.split(',').map((m) => m.trim()).filter(Boolean);
  const allowed = pinned?.length ? targets.filter((t) => pinned.includes(t.key)) : targets;

  if (allowed.length === 0) return [];

  const db = asDrizzle(conn);

  const out: EnqueuedJob[] = [];
  for (const { key, collection } of allowed) {
    const id = jobId(key);
    db.insert(indexingJobs).values({
      id,
      docId: opts.docId,
      modelKey: key,
      collection,
      status: 'pending',
      attempts: 0,
    }).run();
    out.push({ id, docId: opts.docId, modelKey: key, collection });
  }
  return out;
}

/**
 * Atomically claim the next pending job for a worker.
 * Uses UPDATE…RETURNING so SQLite gives us exactly one row even under
 * concurrent claimers (only one wins per row).
 *
 * Returns null when the queue is empty for that model.
 */
export function claimNextJob(conn: JobsDb, modelKey: string): EnqueuedJob | null {
  return claimNextJobs(conn, modelKey, 1)[0] ?? null;
}

export function claimNextJobs(conn: JobsDb, modelKey: string, batchSize = 32): EnqueuedJob[] {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('Invalid worker batch size');
  const db = asDrizzle(conn);
  const nextPending = db.select({ id: indexingJobs.id })
    .from(indexingJobs)
    .where(and(eq(indexingJobs.status, 'pending'), eq(indexingJobs.modelKey, modelKey)))
    .orderBy(asc(indexingJobs.createdAt))
    .limit(batchSize);

  const row = db.update(indexingJobs)
    .set({
      status: 'claimed',
      claimedAt: Date.now(),
      attempts: sql`${indexingJobs.attempts} + 1`,
    })
    .where(inArray(indexingJobs.id, nextPending))
    .returning({
      id: indexingJobs.id,
      docId: indexingJobs.docId,
      modelKey: indexingJobs.modelKey,
      collection: indexingJobs.collection,
    })
    .all();

  return row;
}

export function markJobDone(conn: JobsDb, id: string, reason: string | null = null): void {
  const db = asDrizzle(conn);
  db.update(indexingJobs)
    .set({ status: 'done', finishedAt: Date.now(), error: reason })
    .where(eq(indexingJobs.id, id))
    .run();
}

export function markJobError(conn: JobsDb, id: string, error: string): void {
  // Preserve the row, set status, store the error string. Attempts already
  // incremented at claim time — caller decides retry policy.
  const db = asDrizzle(conn);
  db.update(indexingJobs)
    .set({ status: 'error', finishedAt: Date.now(), error })
    .where(eq(indexingJobs.id, id))
    .run();
}

/** Reset a stuck `claimed` job back to `pending` — for daemon-crash recovery. */
export function reclaimStaleJob(conn: JobsDb, id: string): void {
  const db = asDrizzle(conn);
  db.update(indexingJobs)
    .set({ status: 'pending', claimedAt: null })
    .where(and(eq(indexingJobs.id, id), eq(indexingJobs.status, 'claimed')))
    .run();
}

/** Release a paused claim without charging an infrastructure failure to the document. */
export function pauseVectorJob(conn: JobsDb, id: string): void {
  asDrizzle(conn).update(indexingJobs).set({ status: 'pending', claimedAt: null,
    attempts: sql`MAX(0, ${indexingJobs.attempts} - 1)` })
    .where(and(eq(indexingJobs.id, id), eq(indexingJobs.status, 'claimed'))).run();
}

export function jobsByStatus(
  conn: JobsDb,
  modelKey?: string,
): Array<{ status: string; model_key: string; count: number }> {
  const db = asDrizzle(conn);
  const where = modelKey ? eq(indexingJobs.modelKey, modelKey) : undefined;
  const rows = db.select({
    status: indexingJobs.status,
    modelKey: indexingJobs.modelKey,
    count: count(),
  })
    .from(indexingJobs)
    .where(where)
    .groupBy(indexingJobs.status, indexingJobs.modelKey)
    .orderBy(modelKey ? asc(indexingJobs.status) : asc(indexingJobs.modelKey), asc(indexingJobs.status))
    .all();

  return rows.map((row) => ({
    status: row.status,
    model_key: row.modelKey,
    count: row.count,
  }));
}
