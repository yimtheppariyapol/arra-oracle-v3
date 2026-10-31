import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('the real index-model CLI claims jobs before writing and acknowledges after commit', async () => {
  const h = await incrementalHarness();
  try {
    h.put('a', 'CLI chunk');
    const factory = new URL('../../vector/factory.ts', import.meta.url).pathname;
    const cli = new URL('../../scripts/index-model.ts', import.meta.url).pathname;
    const preload = join(h.dir, 'fake-vector-store.ts');
    await Bun.write(preload, `
      import { mock } from 'bun:test';
      import { Database } from 'bun:sqlite';
      const db = new Database(process.env.ORACLE_DB_PATH);
      const embedder = { name: 'fake', dimensions: 8,
        getIdentity: async () => ({ model: 'fake', digest: 'immutable', dimensions: 8 }),
        embed: async (texts) => texts.map(() => Array(8).fill(0.5)) };
      const write = async (rows) => {
        for (const row of rows) {
          const jobs = db.query('SELECT status FROM indexing_jobs WHERE doc_id = ?').all(row.id);
          if (!jobs.some((j) => j.status === 'claimed')) throw new Error('CLI wrote without a claim');
        }
        console.log('CLAIM_CONFIRMED');
      };
      mock.module(${JSON.stringify(factory)}, () => ({
        EMBEDDING_MODELS: { 'bge-m3': { model: 'bge-m3', collection: 'chunks', adapter: 'lancedb' } },
        createVectorStoreForModel: () => ({ name: 'fake', embedder,
          connect: async () => {}, close: async () => db.close(),
          listDocumentIds: async () => [], upsertVectors: write, addDocuments: write,
          deleteDocuments: async () => {} }),
      }));
    `);
    const child = Bun.spawn([process.execPath, '--preload', preload, cli, 'bge-m3'], {
      env: { ...process.env, ORACLE_DATA_DIR: h.dir, ORACLE_DB_PATH: join(h.dir, 'oracle.db'),
        ORACLE_VECTOR_DB: 'lancedb', ORACLE_VECTOR_DB_PATH: join(h.dir, 'lance') }, stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ code, error: code ? stderr : '' }).toEqual({ code: 0, error: '' });
    expect(stdout).toContain('CLAIM_CONFIRMED');
    expect(h.sqlite.query('SELECT status FROM indexing_jobs').get()).toEqual({ status: 'done' });
  } finally { await h.close(); }
});
