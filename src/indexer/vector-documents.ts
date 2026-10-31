import { inArray } from 'drizzle-orm';
import { asOracleDb, type OracleDbInput } from '../db/drizzle-input.ts';
import { oracleDocuments, oracleFts } from '../db/schema.ts';
import type { VectorDocument } from '../vector/types.ts';
import { isVectorEligible, vectorEligibilityConfig, type VectorEligibilityConfig } from './vector-eligibility.ts';

export interface VectorDocumentState { doc: VectorDocument | null; reason: string | null }

/** SQLite rows are already chunks. Never chunk FTS text a second time. */
export function readVectorDocuments(
  input: OracleDbInput, ids?: string[], config: VectorEligibilityConfig = vectorEligibilityConfig(process.env),
): Map<string, VectorDocumentState> {
  const db = asOracleDb(input);
  const rows: Array<typeof oracleDocuments.$inferSelect> = [];
  if (ids) {
    for (let i = 0; i < ids.length; i += 500) rows.push(...db.select().from(oracleDocuments)
      .where(inArray(oracleDocuments.id, ids.slice(i, i + 500))).all());
  } else rows.push(...db.select().from(oracleDocuments).all());
  const content = new Map<string, string>();
  const wanted = new Set(rows.map((row) => row.id));
  // FTS5 id is UNINDEXED. Scan it once per batch, rather than once per job.
  for (const row of db.select({ id: oracleFts.id, content: oracleFts.content }).from(oracleFts).all()) {
    if (row.id === null || row.content === null || !wanted.has(row.id)) continue;
    content.set(row.id, content.has(row.id) ? `${content.get(row.id)}\n${row.content}` : row.content);
  }
  const states = new Map<string, VectorDocumentState>();
  for (const row of rows) {
    const reason = row.supersededBy !== null || row.supersededAt !== null ? 'superseded'
      : !isVectorEligible({ source_file: row.sourceFile, created_by: row.createdBy }, config) ? 'ineligible'
      : !content.has(row.id) ? 'missing text' : null;
    states.set(row.id, { reason, doc: reason ? null : {
      id: row.id, document: content.get(row.id)!, metadata: {
        tenant_id: row.tenantId, house: row.project ?? '', source_kind: row.type, type: row.type,
        source_file: row.sourceFile, doc_date: row.validTime ?? row.createdAt,
        concepts: row.concepts, ...(row.project && { project: row.project }),
      },
    } });
  }
  if (ids) for (const id of ids) if (!states.has(id)) states.set(id, { doc: null, reason: 'deleted' });
  return states;
}
