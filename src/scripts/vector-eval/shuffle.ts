import type { Query } from './queries.ts';
import type { Chunk } from './snapshot.ts';

/** Seeded bijection over corpus IDs preserves label cardinalities and query texts. */
export function shuffleTruth(queries: Query[], corpus: Chunk[], seed = 761103): Query[] {
  const ids = [...new Set(corpus.map((row) => row.id))];
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = Math.floor(seed / 2 ** 32 * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const mapping = new Map(ids.map((id, i) => [id, shuffled[i]]));
  return queries.map((query) => ({ ...query, relevant: query.relevant.map((id) => mapping.get(id)!),
    derivation: `${query.derivation}; NEGATIVE CONTROL, seeded global corpus-ID permutation` }));
}
