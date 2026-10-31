import { expect, test } from 'bun:test';
import { recommendation } from '../report.ts';
import type { ResultRow } from '../evaluate.ts';
test('replacement needs five percent overall improvement and no Thai-category regression', () => {
  const categories = ['overall', 'thai', 'thai-to-english', 'english-to-thai'];
  const rows: ResultRow[] = ['bge-m3', 'embeddinggemma'].flatMap((model) => categories.map((category) => ({
    method: `${model}/hybrid`, category, queries: 10, ndcg10: 0.5, recall10: 0.5, mrr: 0.5,
  })));
  expect(recommendation(rows, 'hybrid')).toStartWith('Retain bge-m3');
  rows.find((r) => r.method === 'embeddinggemma/hybrid' && r.category === 'overall')!.ndcg10 = 0.525;
  expect(recommendation(rows, 'hybrid')).toStartWith('Replacement candidate');
  rows.find((r) => r.method === 'embeddinggemma/hybrid' && r.category === 'thai')!.ndcg10 = 0.49;
  expect(recommendation(rows, 'hybrid')).toStartWith('Retain bge-m3');
  expect(recommendation([], 'vector')).toContain('baseline unavailable');
});
