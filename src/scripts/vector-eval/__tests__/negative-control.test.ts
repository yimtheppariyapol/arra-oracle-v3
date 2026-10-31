import { expect, test } from 'bun:test';
import { shuffleTruth } from '../shuffle.ts';
import type { Query } from '../queries.ts';
import type { Chunk } from '../snapshot.ts';
test('shuffled labels preserve texts and label cardinalities using a seeded corpus-ID bijection', () => {
  const corpus = Array.from({ length: 100 }, (_, i) => ({ id: `chunk-${i}` }) as Chunk);
  const queries: Query[] = [{ id: 'known', text: 'a known item', category: 'english',
    relevant: ['chunk-0', 'chunk-1'], derivation: 'fixture' }];
  const shuffled = shuffleTruth(queries, corpus);
  expect(shuffled).toEqual(shuffleTruth(queries, corpus));
  expect(shuffled[0].text).toBe(queries[0].text);
  expect(shuffled[0].relevant.length).toBe(2);
  expect(new Set(shuffled[0].relevant).size).toBe(2);
  expect(shuffled[0].relevant).not.toEqual(queries[0].relevant);
  expect(shuffled[0].relevant.every((id) => corpus.some((chunk) => chunk.id === id))).toBe(true);
  expect(queries[0].relevant).toEqual(['chunk-0', 'chunk-1']);
});
