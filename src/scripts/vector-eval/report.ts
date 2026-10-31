import type { ModelResult, ResultRow } from './evaluate.ts';

export function recommendation(rows: ResultRow[], mode: 'vector' | 'hybrid'): string {
  const get = (model: string, category: string) => rows.find((row) => row.method === `${model}/${mode}` && row.category === category);
  const baseline = get('bge-m3', 'overall');
  if (!baseline) return `Retain bge-m3: ${mode} baseline unavailable; replacement rule cannot be evaluated.`;
  const thaiCategories = ['thai', 'thai-to-english', 'english-to-thai'];
  const winners = [...new Set(rows.map((row) => row.method.split('/')[0]))]
    .filter((model) => model !== 'bge-m3' && model !== 'FTS5')
    .filter((model) => {
      const candidate = get(model, 'overall');
      return candidate && candidate.ndcg10 >= baseline.ndcg10 * 1.05
        && candidate.ndcg10 > baseline.ndcg10
        && thaiCategories.every((category) => {
          const b = get('bge-m3', category), c = get(model, category);
          return b && c && c.ndcg10 >= b.ndcg10;
        });
    }).sort((a, b) => get(b, 'overall')!.ndcg10 - get(a, 'overall')!.ndcg10);
  return winners.length
    ? `Replacement candidate for ${mode}: ${winners[0]} meets >=5% relative overall nDCG@10 improvement with no regression in any Thai category. Confirm with human judgements before rollout.`
    : `Retain bge-m3: no measured ${mode} challenger satisfies >=5% relative overall nDCG@10 improvement and no Thai-category regression.`;
}

export async function writeReport(path: string, rows: ResultRow[], models: ModelResult[], negative: boolean) {
  const stats = JSON.parse(await Bun.file('eval-out/corpus-stats.json').text());
  const lines = [
    '# Embedding model evaluation', '',
    `Status: ${models.every((model) => model.status === 'complete') ? 'complete' : 'PARTIAL — vector measurements unavailable'}.`,
    `Ground truth: ${negative ? 'NEGATIVE CONTROL: shuffled chunk-ID labels' : 'known-item proxy, not human relevance judgement'}.`, '',
    `Corpus: ${stats.chunks} eligible chunks; strata ${JSON.stringify(stats.strata)}.`,
    `Thai dominant: ${stats.thaiDominant} (${(stats.thaiRatio * 100).toFixed(2)}%); English dominant: ${stats.englishDominant}; any Thai: ${stats.containsThai}.`,
    'Language proxy: Thai letters > Latin letters. Mixed content is not a separately judged language class.', '',
    'Native queries are heading/sentence excerpts or identifiers. Cross-language queries are assistant paraphrases or local translations, with derivation saved per query.',
    'Exact duplicate text is also labelled relevant; other semantically relevant chunks remain unjudged. No source-disjoint split: these are optimistic known-item retrieval measurements.',
    'FTS5: porter unicode61, BM25 on an in-memory index of this exact sample; quoted tokens joined by OR.',
    'Vector: exact flat cosine over all sampled chunks. Hybrid: RRF(k=60), full FTS and vector rankings.',
    'Binary nDCG@10, recall@10 and MRR (first known item anywhere in the full supplied ranking); macro average over queries.', '',
  ];
  const categories = ['overall', 'english', 'thai', 'code', 'thai-to-english', 'english-to-thai'];
  for (const category of categories) {
    const count = rows.find((row) => row.category === category)?.queries ?? 0;
    lines.push(`## ${category} (${count} queries)`, '', '| Method | nDCG@10 | Recall@10 | MRR |', '| --- | ---: | ---: | ---: |');
    const methods = ['FTS5', ...models.flatMap((model) => [`${model.model}/vector`, `${model.model}/hybrid`])];
    for (const method of methods) {
      const row = rows.find((row) => row.method === method && row.category === category);
      lines.push(`| ${method} | ${row ? `${row.ndcg10.toFixed(6)} | ${row.recall10.toFixed(6)} | ${row.mrr.toFixed(6)}` : 'unavailable | unavailable | unavailable'} |`);
    }
    lines.push('');
  }
  lines.push('## Throughput and memory', '',
    '| Model | Status | Corpus chunks/s | Client peak RSS MiB | Ollama peak RSS MiB | Cache hits / misses |',
    '| --- | --- | ---: | ---: | ---: | --- |');
  for (const model of models) {
    lines.push(`| ${model.model} | ${model.status} | ${model.chunksPerSecond?.toFixed(3) ?? 'unavailable'} | ${model.clientPeakMiB?.toFixed(1) ?? 'unavailable'} | ${model.ollamaPeakMiB?.toFixed(1) ?? 'unavailable'} | ${model.cacheHits ?? 0} / ${model.cacheMisses ?? 0} |`);
  }
  lines.push('', 'Corpus throughput includes cache I/O and model loading; queries excluded. Cached reruns are not cold embedding throughput.',
    'Batch default 16 (hard maximum 64); serial requests, context 2048, no silent truncation, unload each batch. Cache: SHA256(model revision + prepared text + settings), float32.',
    'RSS sampled once per second. Refuse live embedding if Ollama RSS cannot be monitored; stop issuing batches above 4 GiB. Sampling cannot guarantee no transient spike.', '');
  for (const model of models) {
    if (model.error) lines.push(`- ${model.model}: ${model.error.replaceAll('\n', ' ')}`);
    if (model.rssNote) lines.push(`- ${model.model} RSS: ${model.rssNote.replaceAll('\n', ' ')}`);
  }
  lines.push('', '## Recommendation', '', negative
    ? 'This is a shuffled-label control; do not use its rankings to select a production model.'
    : `${recommendation(rows, 'vector')}\n\n${recommendation(rows, 'hybrid')}`,
    '', 'Qwen3-embedding:0.6b is evaluated only if already installed. No automatic model pulls or service changes.', '');
  await Bun.write(path, lines.join('\n'));
}
