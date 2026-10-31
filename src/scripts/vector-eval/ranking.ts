import Database from 'bun:sqlite';
import type { Chunk } from './snapshot.ts';

export async function ftsIndex(corpus: Chunk[]) {
  const db = new Database(':memory:');
  db.exec(await Bun.file(new URL('../../db/migrations/0017_fts5_bootstrap.sql', import.meta.url)).text());
  const insert = db.query('INSERT INTO oracle_fts(id,content,concepts) VALUES (?,?,?)');
  db.transaction(() => { for (const row of corpus) insert.run(row.id, row.content, ''); })();
  return {
    search(query: string): string[] {
      // Literal tokens joined with OR; never execute caller-supplied FTS syntax.
      const tokens = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 64) ?? [];
      if (!tokens.length) return [];
      const match = [...new Set(tokens)].map((term) => `"${term}"`).join(' OR ');
      return db.query<{ id: string }, [string]>(
        'SELECT id FROM oracle_fts WHERE oracle_fts MATCH ? ORDER BY bm25(oracle_fts),id')
        .all(match).map((row) => row.id);
    },
    close: () => db.close(),
  };
}

export function normalize(vector: ArrayLike<number>): Float32Array {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i])) throw new Error('Non-finite embedding');
    norm += vector[i] ** 2;
  }
  if (!norm) throw new Error('Empty or zero embedding');
  const scale = 1 / Math.sqrt(norm);
  return Float32Array.from(vector, (value) => value * scale);
}

/** Exact flat cosine: scan every sampled chunk, no ANN. Inputs are unit vectors. */
export function cosineSearch(query: Float32Array, vectors: Float32Array[], ids: string[]): string[] {
  const scores = vectors.map((vector, index) => {
    if (query.length !== vector.length) throw new Error('Embedding dimension mismatch');
    let score = 0;
    for (let j = 0; j < vector.length; j++) score += query[j] * vector[j];
    return { id: ids[index], score };
  });
  return scores.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).map((row) => row.id);
}
