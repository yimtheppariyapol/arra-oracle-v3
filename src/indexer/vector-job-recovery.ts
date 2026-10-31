import { and, eq, inArray, lt } from 'drizzle-orm';
import { asOracleDb, type OracleDbInput } from '../db/drizzle-input.ts';
import { indexingJobs } from '../db/schema.ts';
import { enqueueIndexJob } from './jobs.ts';
import { loadVectorIndexManifest } from './vector-index-manifest.ts';
import { readVectorDocuments } from './vector-documents.ts';

/** One writer per model: on restart, every prior claim belongs to the dead worker. */
export function recoverVectorJobs(input: OracleDbInput, modelKey: string, includeClaimed = false): void {
  const db = asOracleDb(input);
  if (includeClaimed) db.update(indexingJobs).set({ status: 'pending', claimedAt: null })
    .where(and(eq(indexingJobs.modelKey, modelKey), eq(indexingJobs.status, 'claimed'))).run();
  db.update(indexingJobs).set({ status: 'pending', claimedAt: null })
    .where(and(eq(indexingJobs.modelKey, modelKey), eq(indexingJobs.status, 'error'),
      lt(indexingJobs.attempts, 3), lt(indexingJobs.finishedAt, Date.now() - 1000))).run();
}

// Parser/collector namespaces; arbitrary frontmatter/import ids require a manifest as proof.
const indexerDocumentId = /^(?:learning|resonance|retro|distillation|security_corpus)_[^:\s]+$/;

/** Shared collections contain other writers' rows. Absence from SQLite alone is not ownership. */
export function queueVectorTombstones(input: OracleDbInput, modelKey: string, collection: string, vectorIds: string[] = []): number {
  const db = asOracleDb(input);
  const manifest = loadVectorIndexManifest(input, modelKey);
  const ids = [...new Set([...manifest.keys(), ...vectorIds.filter((id) => indexerDocumentId.test(id))])];
  if (!ids.length) return 0;
  const states = readVectorDocuments(input, ids);
  const active = new Set(db.select({ docId: indexingJobs.docId }).from(indexingJobs)
    .where(and(eq(indexingJobs.modelKey, modelKey), inArray(indexingJobs.status, ['pending', 'claimed']))).all()
    .map((row) => row.docId));
  let queued = 0;
  db.transaction(() => {
    for (const [docId, state] of states) {
      if (!state.reason || active.has(docId)) continue;
      if (!manifest.has(docId) && state.reason !== 'deleted' && state.reason !== 'superseded') continue;
      queued += enqueueIndexJob(db, { docId, modelKey, models: { [modelKey]: { collection } } }).length;
    }
  });
  return queued;
}
