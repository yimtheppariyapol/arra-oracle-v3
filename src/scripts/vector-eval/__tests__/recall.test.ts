import { expect, test } from 'bun:test';
import { metrics } from '../metrics.ts';
test('recall counts unique relevant items within ten and divides by all known relevant items', () => {
  expect(metrics(['a', 'a', 'x', 'b'], ['a', 'b', 'c', 'c']).recall10).toBeCloseTo(2 / 3, 12);
  expect(metrics(Array.from({ length: 11 }, (_, i) => String(i)), ['0', '10']).recall10).toBe(0.5);
  expect(metrics([], ['a']).recall10).toBe(0);
});
