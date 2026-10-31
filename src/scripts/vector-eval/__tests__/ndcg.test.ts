import { expect, test } from 'bun:test';
import { metrics } from '../metrics.ts';
test('nDCG discounts two relevant items at ranks two and three against ideal ranks one and two', () => {
  const expected = (1 / Math.log2(3) + 1 / Math.log2(4)) / (1 + 1 / Math.log2(3));
  expect(metrics(['x', 'a', 'b'], ['a', 'b']).ndcg10).toBeCloseTo(expected, 12);
  expect(metrics(['x'], ['a']).ndcg10).toBe(0);
  expect(metrics(['a'], []).ndcg10).toBe(0);
  expect(metrics(Array.from({ length: 11 }, (_, i) => String(i)), ['10']).ndcg10).toBe(0);
});
