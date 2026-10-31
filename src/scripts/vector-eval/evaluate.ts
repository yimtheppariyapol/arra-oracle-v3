import { average, metrics, rrf, type Metrics } from './metrics.ts';
import { cosineSearch } from './ranking.ts';
import type { Query } from './queries.ts';
import type { Chunk } from './snapshot.ts';
import { CachedEmbedder } from './embeddings.ts';
import { monitorResources } from './resources.ts';

export interface ResultRow extends Metrics { method: string; category: string; queries: number }
export interface ModelResult {
  model: string; status: string; chunksPerSecond?: number; seconds?: number;
  clientPeakMiB?: number; ollamaPeakMiB?: number | null; rssNote?: string;
  cacheHits?: number; cacheMisses?: number; error?: string;
  violation?: string;
}

export function summarize(method: string, queries: Query[], rankings: string[][]): ResultRow[] {
  return ['overall', ...new Set(queries.map((q) => q.category))].map((category) => {
    const values = queries.flatMap((query, i) => category === 'overall' || query.category === category
      ? [metrics(rankings[i], query.relevant)] : []);
    return { method, category, queries: values.length, ...average(values) };
  });
}

export async function evaluateModel(model: string, revision: string, corpus: Chunk[], queries: Query[],
  fts: string[][], batch: number, rows: ResultRow[], prediction: (method: string, ranks: string[][]) => Promise<void>,
): Promise<ModelResult> {
  const resources = await monitorResources();
  const embedder = new CachedEmbedder(model, revision, batch);
  let info: ModelResult = { model, status: 'unavailable' };
  try {
    resources.check();
    const start = performance.now();
    const vectors = await embedder.embed(corpus.map((row) => row.content), false, resources.check);
    const seconds = (performance.now() - start) / 1000;
    resources.check();
    const queryVectors = await embedder.embed(queries.map((query) => query.text), true, resources.check);
    resources.check();
    const ids = corpus.map((row) => row.id);
    const ranks = queryVectors.map((query) => cosineSearch(query, vectors, ids));
    const hybrid = ranks.map((ranking, i) => rrf([fts[i], ranking]));
    await prediction(`${model}/vector`, ranks);
    await prediction(`${model}/hybrid`, hybrid);
    rows.push(...summarize(`${model}/vector`, queries, ranks), ...summarize(`${model}/hybrid`, queries, hybrid));
    info = { model, status: 'complete', seconds, chunksPerSecond: corpus.length / seconds };
  } catch (error) { info.error = error instanceof Error ? error.message : String(error); }
  finally {
    info = { ...info, ...await resources.stop(), cacheHits: embedder.hits, cacheMisses: embedder.misses };
    if (info.violation) {
      info.status = 'unavailable'; info.error = info.violation;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].method.startsWith(`${model}/`)) rows.splice(i, 1);
      }
    }
  }
  return info;
}
