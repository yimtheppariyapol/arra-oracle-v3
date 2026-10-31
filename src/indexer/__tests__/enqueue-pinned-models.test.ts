/**
 * Guards: with ORACLE_VECTOR_MODELS pinned, enqueueIndexJob queues only those models even when a
 * caller passes the full registry (learn tool, file watcher). 70 stray nomic/qwen3 jobs appeared
 * in the 2026-11-01 pilot from such callers. Unpinned keeps the old all-models behaviour.
 */
import { expect, test } from 'bun:test';
import { createDatabase } from '../../db/create.ts';
import { enqueueIndexJob } from '../jobs.ts';

const models = { 'bge-m3': { collection: 'a' }, nomic: { collection: 'b' }, qwen3: { collection: 'c' } };

test('pinned production models filter every enqueue', () => {
  const saved = process.env.ORACLE_VECTOR_MODELS;
  const { sqlite } = createDatabase(':memory:');
  try {
    process.env.ORACLE_VECTOR_MODELS = 'bge-m3';
    expect(enqueueIndexJob(sqlite, { docId: 'd1', models }).map((j) => j.modelKey)).toEqual(['bge-m3']);
    delete process.env.ORACLE_VECTOR_MODELS;
    expect(enqueueIndexJob(sqlite, { docId: 'd2', models }).map((j) => j.modelKey).sort()).toEqual(['bge-m3', 'nomic', 'qwen3']);
  } finally {
    sqlite.close();
    if (saved === undefined) delete process.env.ORACLE_VECTOR_MODELS; else process.env.ORACLE_VECTOR_MODELS = saved;
  }
});
