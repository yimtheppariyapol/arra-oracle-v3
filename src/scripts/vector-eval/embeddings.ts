import { createHash } from 'crypto';
import { mkdir, rename } from 'fs/promises';
import { normalize } from './ranking.ts';

const BASE = 'http://127.0.0.1:11434';
const LIMIT = 4 * 1024 ** 3;

export async function localModels(): Promise<Map<string, string>> {
  const response = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Ollama tags HTTP ${response.status}`);
  const data = await response.json() as { models: { name: string; digest: string }[] };
  return new Map(data.models.flatMap((model) => [[model.name, model.digest],
    [model.name.replace(/:latest$/, ''), model.digest]]));
}

export function modelInput(model: string, text: string, query: boolean): string {
  // Mirror src/vector/embeddings.ts prepareText: 2,000-char cap and the same prefixes.
  text = text.length > 2000 ? text.slice(0, 2000) : text;
  if (model.startsWith('bge-m3')) return `${query ? 'query' : 'passage'}: ${text}`;
  if (model.startsWith('qwen3') && query) {
    return `Instruct: Given a search query, retrieve relevant passages that answer the query\nQuery: ${text}`;
  }
  if (model.startsWith('embeddinggemma')) return query
    ? `task: search result | query: ${text}` : `title: none | text: ${text}`;
  return text;
}

export function cacheKey(modelIdentity: string, text: string): string {
  return createHash('sha256').update(JSON.stringify([modelIdentity, text])).digest('hex');
}

export class CachedEmbedder {
  hits = 0;
  misses = 0;
  constructor(readonly model: string, readonly revision: string, readonly batchSize = 16,
    readonly request: typeof fetch = fetch) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 64) throw new Error('Embedding batch must be 1..64');
  }

  async embed(texts: string[], query = false, check: () => void = () => {}): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];
    for (let start = 0; start < texts.length; start += this.batchSize) {
      check();
      if (process.memoryUsage().rss > LIMIT) throw new Error('Eval process RSS exceeded 4 GiB');
      const inputs = texts.slice(start, start + this.batchSize).map((text) => modelInput(this.model, text, query));
      const identity = `${this.model}@${this.revision};ctx=2048;f32-v1`;
      const paths = inputs.map((input) => `eval-out/cache/${cacheKey(identity, input)}.f32`);
      const batch: Array<Float32Array | undefined> = await Promise.all(paths.map(async (path) => {
        if (!await Bun.file(path).exists()) return undefined;
        const bytes = await Bun.file(path).arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength % 4) throw new Error(`Corrupt cache: ${path}`);
        this.hits++;
        return normalize(new Float32Array(bytes));
      }));
      const missing = batch.flatMap((v, i) => v ? [] : [i]);
      if (missing.length) {
        const response = await this.request(`${BASE}/api/embed`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(180_000),
          // Unload after each bounded batch: never retain multiple evaluation models.
          body: JSON.stringify({ model: this.model, input: missing.map((i) => inputs[i]),
            truncate: false, keep_alive: 0, options: { num_ctx: 2048 } }),
        });
        if (!response.ok) throw new Error(`Embed ${this.model} HTTP ${response.status}: ${await response.text()}`);
        const data = await response.json() as { embeddings: number[][] };
        if (data.embeddings?.length !== missing.length) throw new Error('Incorrect embedding batch length');
        await mkdir('eval-out/cache', { recursive: true });
        for (const [j, i] of missing.entries()) {
          const vector = normalize(data.embeddings[j]);
          await Bun.write(`${paths[i]}.tmp`, vector);
          await rename(`${paths[i]}.tmp`, paths[i]);
          batch[i] = vector;
          this.misses++;
        }
      }
      vectors.push(...batch as Float32Array[]);
      if (!query && start % 256 === 0) console.log(`${this.model}: ${Math.min(start + this.batchSize, texts.length)}/${texts.length} chunks`);
    }
    return vectors;
  }
}
