/**
 * The LanceDB writer must compact and prune as it goes.
 *
 * Every mergeInsert/delete writes a new fragment and a new version, and nothing ever called
 * `table.optimize()`. On the step-5 backfill (2026-11-01) the bge-m3 table reached 2,849 data
 * fragments and 22,322 versions for 44k rows (1.8 GB), and /api/health took 17-21 s counting rows,
 * so the watchdog judged a healthy server dead and spawned a doomed second server every 5 min.
 * Per-id deletes made it worse: one version per deleted id.
 *
 * Runs against real LanceDB in a tmp dir; the claim is about files LanceDB leaves on disk.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { LanceDBAdapter } from '../adapters/lancedb.ts';
import type { EmbeddingProvider, EmbedType, VectorDocument } from '../types.ts';

class FixedEmbedder implements EmbeddingProvider {
  readonly name = 'fixed';
  readonly dimensions = 8;
  async embed(texts: string[], _type?: EmbedType): Promise<number[][]> {
    return texts.map(() => Array.from({ length: 8 }, (_, j) => 0.1 + j * 0.01));
  }
}

const doc = (id: string, seed: number): VectorDocument & { vector: number[] } => ({
  id,
  document: `text ${id}`,
  metadata: { type: 'test' },
  vector: Array.from({ length: 8 }, (_, i) => seed + i * 0.01),
});

const TMP_BASE = path.join(os.tmpdir(), `oracle-optimize-${process.pid}`);
const countIn = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).length : 0);

async function freshAdapter(name: string): Promise<{ adapter: LanceDBAdapter; tableDir: string }> {
  const dir = path.join(TMP_BASE, name);
  fs.mkdirSync(dir, { recursive: true });
  const adapter = new LanceDBAdapter(name, dir, new FixedEmbedder());
  await adapter.connect();
  await adapter.ensureCollection();
  return { adapter, tableDir: path.join(dir, `${name}.lance`) };
}

describe('LanceDB writer compacts and prunes', () => {
  const adapters: LanceDBAdapter[] = [];

  afterEach(async () => {
    for (const a of adapters.splice(0)) { try { await a.close(); } catch { /* best effort */ } }
    delete process.env.ORACLE_LANCE_OPTIMIZE_EVERY;
    delete process.env.ORACLE_LANCE_KEEP_VERSIONS_MS;
    try { fs.rmSync(TMP_BASE, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('keeps fragments and versions bounded across many small upserts', async () => {
    process.env.ORACLE_LANCE_OPTIMIZE_EVERY = '10';
    process.env.ORACLE_LANCE_KEEP_VERSIONS_MS = '0';
    const { adapter, tableDir } = await freshAdapter('opt_bounded');
    adapters.push(adapter);

    for (let i = 0; i < 40; i++) await adapter.upsertVectors([doc(`d${i}`, i)]);

    expect((await adapter.getStats()).count).toBe(40);
    // Without optimize: 40+ fragments and 40+ versions.
    expect(countIn(path.join(tableDir, 'data'))).toBeLessThan(15);
    expect(countIn(path.join(tableDir, '_versions'))).toBeLessThan(15);
  });

  it('deletes many ids in one version, not one per id', async () => {
    process.env.ORACLE_LANCE_OPTIMIZE_EVERY = '1000';
    const { adapter, tableDir } = await freshAdapter('opt_delete');
    adapters.push(adapter);
    await adapter.upsertVectors(Array.from({ length: 30 }, (_, i) => doc(`x${i}'q`, i)));
    const before = countIn(path.join(tableDir, '_versions'));

    await adapter.deleteDocuments(Array.from({ length: 30 }, (_, i) => `x${i}'q`));

    expect((await adapter.getStats()).count).toBe(0);
    expect(countIn(path.join(tableDir, '_versions')) - before).toBe(1);
  });
});
