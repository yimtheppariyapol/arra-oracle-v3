import { inArray } from 'drizzle-orm';
import { asOracleDb, type OracleDbInput } from '../db/drizzle-input.ts';
import { oracleDocuments, oracleFtsContent } from '../db/schema.ts';
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
  const wanted = rows.map((row) => row.id);
  for (let i = 0; i < wanted.length; i += 500) {
    const matches = db.select({ id: oracleFtsContent.docId, content: oracleFtsContent.content })
      .from(oracleFtsContent)
      .where(inArray(oracleFtsContent.docId, wanted.slice(i, i + 500))).all();
    for (const row of matches) {
      if (row.id === null || row.content === null) continue;
      content.set(row.id, content.has(row.id) ? `${content.get(row.id)}\n${row.content}` : row.content);
    }
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
