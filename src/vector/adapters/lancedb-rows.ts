import type { EmbeddingProvider, VectorDocument } from '../types.ts';
import { documentVectors } from '../document-vectors.ts';

export const LANCE_FILTER_COLUMNS = ['house', 'source_kind', 'source_file', 'doc_date',
  'tenant_id', 'model_key', 'chunker_version', 'type', 'project'] as const;

export function lanceRow(doc: VectorDocument, vector: number[]) {
  const meta = doc.metadata;
  const text = (key: string) => typeof meta[key] === 'string' ? meta[key] as string : '';
  const date = meta.doc_date ?? 0;
  if (typeof date !== 'number' || !Number.isSafeInteger(date)) throw new Error('doc_date must be epoch milliseconds');
  return {
    id: doc.id, text: doc.document, metadata: JSON.stringify(meta), vector,
    house: text('house') || text('project'), source_kind: text('source_kind') || text('type'), source_file: text('source_file'),
    doc_date: date, tenant_id: text('tenant_id'), model_key: text('model_key'),
    chunker_version: text('chunker_version'), type: text('type'), project: text('project'), metadata_version: 2,
  };
}

/** Compatibility for text-only callers; supplied vectors always bypass embedding. */
export async function buildLanceRows(docs: VectorDocument[], embedder: EmbeddingProvider) {
  const vectors = await documentVectors(docs, embedder);
  return { rows: docs.map((doc, i) => lanceRow(doc, vectors[i])),
    reused: docs.filter((doc) => doc.vector !== undefined).length };
}
