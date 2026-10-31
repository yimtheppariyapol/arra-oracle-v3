import type { Table } from '@lancedb/lancedb';

export function legacyMetadata(raw: unknown): Record<string, string | number> {
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { console.warn('[LanceDB] Invalid legacy metadata; preserving vector with empty typed fields'); return {}; }
}

/** Prefer the latest explicit write timestamp, then the latest physical row id. */
export async function dedupeLegacyRows(table: Table): Promise<void> {
  const rows = await table.query().select(['id', 'metadata']).withRowId().toArray();
  const winners = new Map<string, { rowId: bigint; date: number }>();
  const dropped: Array<{ id: string; rowId: bigint }> = [];
  for (const row of rows) {
    const meta = legacyMetadata(row.metadata);
    const date = Number(meta.updated_at ?? meta.indexed_at ?? meta.created_at ?? meta.doc_date ?? 0) || 0;
    const rowId = BigInt(row._rowid);
    const previous = winners.get(row.id);
    if (!previous) winners.set(row.id, { rowId, date });
    else if (date > previous.date || (date === previous.date && rowId > previous.rowId)) {
      dropped.push({ id: row.id, rowId: previous.rowId }); winners.set(row.id, { rowId, date });
    } else dropped.push({ id: row.id, rowId });
  }
  for (let i = 0; i < dropped.length; i += 256) {
    const batch = dropped.slice(i, i + 256);
    await table.delete(`_rowid IN (${batch.map((row) => row.rowId).join(',')})`);
    console.warn(`[LanceDB] Dropped duplicate row ids: ${batch.map((row) => `${row.id}@${row.rowId}`).join(', ')}`);
  }
  if (dropped.length) console.warn(`[LanceDB] Dropped ${dropped.length} duplicate rows; kept newest timestamp then physical row id`);
}
