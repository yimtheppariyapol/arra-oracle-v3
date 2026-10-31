import { expect, test } from 'bun:test';
import { rrf } from '../metrics.ts';
test('RRF sums reciprocal ranks across lists with deterministic ties and no duplicate voting', () => {
  // k=0: b=1/2+1=1.5, a=1, c=1/2.
  expect(rrf([['a', 'b'], ['b', 'c']], 0)).toEqual(['b', 'a', 'c']);
  expect(rrf([['a', 'a'], ['b']], 0)).toEqual(['a', 'b']);
  expect(rrf([], 60)).toEqual([]);
  expect(rrf([['a', 'b'], ['b', 'a']], 60)).toEqual(['a', 'b']);
});
