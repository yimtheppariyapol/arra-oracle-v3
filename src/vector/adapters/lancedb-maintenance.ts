/**
 * lancedb-maintenance.ts — keep a LanceDB table compact while one writer appends to it.
 *
 * Why: every mergeInsert/delete adds a fragment and a version, and nothing called optimize().
 * The step-5 backfill (2026-11-01) left 2,849 fragments and 22,322 versions for 44k rows, and
 * countRows in /api/health took 17-21 s. Readers call checkoutLatest() before every query, so
 * pruning versions older than a few minutes never pulls files from under a live read.
 * Pairs with: lancedb.ts upsertVectors/deleteDocuments, lancedb-optimize.test.ts.
 */

const DEFAULT_EVERY = 20; // LanceDB docs: optimize after ~20 modification operations
const DEFAULT_KEEP_MS = 10 * 60_000;
const DELETE_CHUNK = 500;

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export class LanceMaintenance {
  private writes = 0;

  /** Count one write; run optimize when the threshold is reached. Never throws. */
  async afterWrite(table: any): Promise<void> {
    this.writes++;
    if (this.writes < Math.max(1, envInt('ORACLE_LANCE_OPTIMIZE_EVERY', DEFAULT_EVERY))) return;
    this.writes = 0;
    const keepMs = envInt('ORACLE_LANCE_KEEP_VERSIONS_MS', DEFAULT_KEEP_MS);
    try {
      const started = Date.now();
      const stats = await table.optimize({ cleanupOlderThan: new Date(Date.now() - keepMs) });
      console.error(`[LanceDB] optimize: ${JSON.stringify(stats)} in ${Date.now() - started}ms`);
    } catch (error) {
      console.warn('[LanceDB] optimize failed:', error instanceof Error ? error.message : String(error));
    }
  }
}

/** One delete (one version) per chunk of ids instead of one per id. */
export function deletePredicates(ids: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const quoted = ids.slice(i, i + DELETE_CHUNK).map((id) => `'${id.replaceAll("'", "''")}'`);
    out.push(`id IN (${quoted.join(', ')})`);
  }
  return out;
}
