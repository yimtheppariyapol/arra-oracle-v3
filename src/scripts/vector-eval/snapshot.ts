import { Database } from 'bun:sqlite';
import { ftsJoin } from '../../db/fts-lookup.ts';
import { isVectorEligible, vectorEligibilityConfig, vectorSourcePath } from '../../indexer/vector-eligibility.ts';

export interface Chunk {
  id: string;
  source_file: string;
  created_by: string | null;
  content: string;
  tenant_id: string;
  category: string;
}

/** Only SELECT over the explicitly permitted mode=ro URI; no app DB imports. */
export async function* snapshotRows(content = true): AsyncGenerator<Chunk> {
  const dbPath = `${process.env.HOME}/.arra-oracle-v2/oracle.db`;
  const uri = `file:${dbPath}?mode=ro`;
  const sqlite = content ? new Database(dbPath, { readonly: true }) : null;
  let join = '';
  try { if (sqlite) join = `JOIN ${ftsJoin(sqlite)}`; } finally { sqlite?.close(); }
  const query = `SELECT json_object('id',d.id,'source_file',d.source_file,
    'created_by',d.created_by,'tenant_id',d.tenant_id,'content',${content ? 'f.content' : "''"})
    FROM oracle_documents d ${join}
    WHERE d.superseded_by IS NULL AND d.superseded_at IS NULL ORDER BY d.id${content ? ',f.rowid' : ''};`;
  const proc = Bun.spawn(['sqlite3', uri, query], { stdout: 'pipe', stderr: 'pipe' });
  const error = new Response(proc.stderr).text();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for await (const bytes of proc.stdout) {
      pending += decoder.decode(bytes, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.trim()) yield JSON.parse(line) as Chunk;
      }
    }
    if (pending.trim()) yield JSON.parse(pending) as Chunk;
    if (await proc.exited !== 0) throw new Error(`Read-only snapshot failed: ${await error}`);
  } finally {
    if (proc.exitCode === null) proc.kill();
  }
}

export function stratum(path: string): string {
  path = vectorSourcePath(path);
  if (path.startsWith('ψ/inbox/')) return 'handoffs';
  if (path.startsWith('ψ/learn/')) return 'study';
  if (path.includes('/retrospectives/')) return 'retros';
  if (path.includes('/learnings/')) return 'learnings';
  return 'other';
}

export function language(text: string): 'thai' | 'english' {
  const thai = text.match(/[\u0e00-\u0e7f]/g)?.length ?? 0;
  const latin = text.match(/[a-z]/gi)?.length ?? 0;
  return thai > latin ? 'thai' : 'english';
}

function randomSource(seed = 20261031) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}

export async function sampleCorpus(size: number): Promise<Chunk[]> {
  const groups = new Map<string, { seen: number; rows: Chunk[] }>();
  const random = randomSource();
  const config = vectorEligibilityConfig(process.env);
  // Each reservoir can hold N, allowing deterministic redistribution of scarce strata.
  for await (const row of snapshotRows()) {
    if (!row.content?.trim() || !isVectorEligible(row, config)) continue;
    row.category = stratum(row.source_file);
    const group = groups.get(row.category) ?? { seen: 0, rows: [] };
    group.seen++;
    if (group.rows.length < size) group.rows.push(row);
    else {
      const slot = Math.floor(random() * group.seen);
      if (slot < size) group.rows[slot] = row;
    }
    groups.set(row.category, group);
  }
  const result: Chunk[] = [];
  const queues = ['learnings', 'retros', 'study', 'handoffs', 'other'].map((key) => groups.get(key)?.rows ?? []);
  for (let i = 0; result.length < size && queues.some((q) => i < q.length); i++) {
    for (const queue of queues) {
      if (i < queue.length && result.length < size) result.push(queue[i]);
    }
  }
  if (result.length < size) throw new Error(`Only ${result.length} eligible nonempty chunks; requested ${size}`);
  return result;
}
