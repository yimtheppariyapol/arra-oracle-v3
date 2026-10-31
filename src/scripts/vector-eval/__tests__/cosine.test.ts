import { expect, test } from 'bun:test';
import { cosineSearch, normalize } from '../ranking.ts';
test('exact cosine ranks direction rather than magnitude and rejects invalid dimensions', () => {
  const vectors = [[0, 8], [10, 0], [1, 1]].map(normalize);
  expect(cosineSearch(normalize([1, 0]), vectors, ['north', 'east', 'diagonal']))
    .toEqual(['east', 'diagonal', 'north']);
  expect(() => normalize([0, 0])).toThrow();
  expect(() => normalize([NaN, 1])).toThrow();
  expect(() => cosineSearch(normalize([1, 0]), [normalize([1])], ['bad'])).toThrow();
});
