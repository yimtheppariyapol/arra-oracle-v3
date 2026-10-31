/** Isolated native benchmark: no config, service endpoints, or model calls. */
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LanceDBAdapter } from '../../vector/adapters/lancedb.ts';
import { SqliteVecAdapter } from '../../vector/adapters/sqlite-vec.ts';
import type { EmbeddingProvider, VectorDocument } from '../../vector/types.ts';

// Apple's system SQLite disables extension loading. Choose Homebrew before the first DB opens.
if (process.platform === 'darwin') {
  const library = ['/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib', '/usr/local/opt/sqlite/lib/libsqlite3.dylib']
    .find(existsSync);
  if (!library) throw new Error('sqlite-vec parity on macOS requires extension-enabled SQLite');
  Database.setCustomSQLite(library);
}

function rng(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}
function unitVector(random: () => number): number[] {
  const vector = Array.from({ length: 1024 }, () => random() * 2 - 1);
  const length = Math.hypot(...vector);
  return vector.map((value) => Math.fround(value / length));
}
function percentiles(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { p50_ms: sorted[Math.ceil(sorted.length * 0.5) - 1], p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

export async function scale20k() {
  const directory = await mkdtemp(join(tmpdir(), 'vector-scale-20k-'));
  const embedder: EmbeddingProvider = { name: 'never-embed', dimensions: 1024,
    async embed() { throw new Error('Synthetic parity must never embed'); } };
  const lance = new LanceDBAdapter('scale', join(directory, 'lance'), embedder);
  const exact = new SqliteVecAdapter('scale', join(directory, 'vectors.db'), embedder);
  const random = rng(340031);
  let peakRss = process.memoryUsage().rss;
  const sampleRss = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss); };
  try {
    await lance.connect(); await lance.ensureCollection(); await exact.connect(); await exact.ensureCollection();
    for (let offset = 0; offset < 20_000; offset += 500) {
      const docs: VectorDocument[] = Array.from({ length: 500 }, (_, j) => {
        const i = offset + j;
        return { id: `v${i}`, document: `synthetic ${i}`, vector: unitVector(random), metadata: {
          house: i % 100 < 3 ? 'rare' : 'common', tenant_id: i % 100 < 3 ? 'tenant-b' : 'tenant-a',
          source_kind: 'synthetic', source_file: `${i}.md`, doc_date: 1_700_000_000_000 + i,
          model_key: 'bge-m3', chunker_version: 'paragraph-800-v1',
        } };
      });
      await lance.addDocuments(docs); await exact.addDocuments(docs); sampleRss();
    }
    const rssLoaded = process.memoryUsage().rss;
    const samples = { lance: [] as number[], sqlite: [] as number[], lance_filtered: [] as number[], sqlite_filtered: [] as number[] };
    const recall = { all: [] as number[], filtered: [] as number[] };
    // Independent held-out random queries, not self-neighbor lookups. Five warmups, forty measurements.
    for (let i = 0; i < 45; i++) {
      const vector = unitVector(random);
      for (const filtered of [false, true]) {
        const where = filtered ? { house: 'rare', tenant_id: 'tenant-b' } : undefined;
        const t0 = performance.now(); const found = await lance.queryByVector(vector, 10, where);
        const t1 = performance.now(); const truth = await exact.queryByVector(vector, 10, where);
        const t2 = performance.now();
        if (found.ids.length !== 10 || truth.ids.length !== 10) throw new Error('Filtered KNN underfilled');
        if (where && found.metadatas.some((meta) => meta.house !== where.house || meta.tenant_id !== where.tenant_id)) {
          throw new Error('Cross-tenant/house leakage');
        }
        const overlap = found.ids.filter((id) => truth.ids.includes(id)).length / 10;
        if (i >= 5) {
          samples[filtered ? 'lance_filtered' : 'lance'].push(t1 - t0);
          samples[filtered ? 'sqlite_filtered' : 'sqlite'].push(t2 - t1);
          recall[filtered ? 'filtered' : 'all'].push(overlap);
        }
      }
      sampleRss();
    }
    const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    return { seed: 340031, rows: 20_000, dimensions: 1024, measured_queries_per_mode: 40, warmups: 5,
      metric: 'cosine LanceDB / L2 sqlite-vec on unit-normalized float32', lance_vector_index: 'flat (no ANN index)',
      recall_at_10: average(recall.all), filtered_recall_at_10: average(recall.filtered),
      latency: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, percentiles(values)])),
      rss_after_load_bytes: rssLoaded, peak_sampled_rss_bytes: peakRss, rss_final_bytes: process.memoryUsage().rss,
      platform: `${process.platform}/${process.arch}`, bun: Bun.version };
  } finally { await lance.close(); await exact.close(); await rm(directory, { recursive: true }); }
}
if (import.meta.main) console.log(`SCALE_20K ${JSON.stringify(await scale20k())}`);
