import { Index, type Table } from '@lancedb/lancedb';
import { LANCE_FILTER_COLUMNS, lanceRow } from './lancedb-rows.ts';

/** Upgrade old JSON-only tables in place, resumably, without embedding or dropping rows. */
export async function ensureLanceMetadata(table: Table): Promise<void> {
  const fields = new Set((await table.schema()).fields.map((field) => field.name));
  const columns = [...LANCE_FILTER_COLUMNS, 'metadata_version'];
  const missing = columns.filter((column) => !fields.has(column));
  if (missing.length) await table.addColumns(missing.map((name) => ({
    name, valueSql: `CAST(NULL AS ${name === 'doc_date' || name === 'metadata_version' ? 'DOUBLE' : 'STRING'})`,
  })));
  while (true) {
    const rows = await table.query().where('metadata_version IS NULL').limit(256).toArray();
    if (!rows.length) break;
    const converted = rows.map((row) => lanceRow({
      id: row.id, document: row.text, metadata: JSON.parse(row.metadata || '{}'),
    }, Array.from(row.vector)));
    await table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(converted);
  }
  const indexed = new Set((await table.listIndices()).flatMap((index) => index.columns));
  for (const column of LANCE_FILTER_COLUMNS) {
    if (!indexed.has(column)) await table.createIndex(column, { config: Index.btree() });
  }
}

export function lanceFilter(where?: Record<string, unknown>): string | undefined {
  if (!where || !Object.keys(where).length) return undefined;
  return Object.entries(where).map(([key, value]) => {
    if (![...LANCE_FILTER_COLUMNS, 'id'].includes(key as typeof LANCE_FILTER_COLUMNS[number])) {
      throw new Error(`Unsupported LanceDB filter column: ${key}`);
    }
    if (value === null) return `\`${key}\` IS NULL`;
    const literal = typeof value === 'string' ? `'${value.replaceAll("'", "''")}'`
      : typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
    if (literal === null) throw new Error(`Unsupported LanceDB filter value: ${key}`);
    return `\`${key}\` = ${literal}`;
  }).join(' AND ');
}
