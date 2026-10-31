export interface Metrics { ndcg10: number; recall10: number; mrr: number }

export function metrics(ranking: string[], relevant: string[], k = 10): Metrics {
  const truth = new Set(relevant);
  const unique = [...new Set(ranking)];
  if (!truth.size) return { ndcg10: 0, recall10: 0, mrr: 0 };
  let hits = 0, dcg = 0;
  for (const [i, id] of unique.slice(0, k).entries()) {
    if (truth.has(id)) { hits++; dcg += 1 / Math.log2(i + 2); }
  }
  let ideal = 0;
  for (let i = 0; i < Math.min(k, truth.size); i++) ideal += 1 / Math.log2(i + 2);
  const rank = unique.findIndex((id) => truth.has(id));
  return { ndcg10: dcg / ideal, recall10: hits / truth.size, mrr: rank < 0 ? 0 : 1 / (rank + 1) };
}

export function rrf(rankings: string[][], constant = 60): string[] {
  if (constant < 0) throw new Error('RRF constant must be nonnegative');
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    for (const [i, id] of [...new Set(ranking)].entries()) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (constant + i + 1));
    }
  }
  return [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}

export function average(rows: Metrics[]): Metrics {
  if (!rows.length) return { ndcg10: 0, recall10: 0, mrr: 0 };
  return Object.fromEntries(['ndcg10', 'recall10', 'mrr'].map((key) => [key,
    rows.reduce((sum, row) => sum + row[key as keyof Metrics], 0) / rows.length])) as unknown as Metrics;
}
