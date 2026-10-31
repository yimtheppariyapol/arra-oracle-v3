import { expect, test } from 'bun:test';
import { metrics } from '../metrics.ts';
test('reciprocal rank uses the first relevant result in the supplied ranking', () => {
  expect(metrics(['x', 'a', 'b'], ['a', 'b']).mrr).toBe(0.5);
  expect(metrics(['x'], ['a']).mrr).toBe(0);
  expect(metrics(Array.from({ length: 11 }, (_, i) => String(i)), ['10']).mrr).toBe(1 / 11);
});
