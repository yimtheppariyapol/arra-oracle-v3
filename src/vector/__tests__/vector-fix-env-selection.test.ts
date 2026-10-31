import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('unconfigured model registry and factory select LanceDB only when env requests it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vector-env-'));
  const dataDir = process.env.ORACLE_DATA_DIR; const engine = process.env.ORACLE_VECTOR_DB;
  try {
    process.env.ORACLE_DATA_DIR = dir;
    delete process.env.ORACLE_VECTOR_DB;
    const { createVectorStore, getEmbeddingModels } = await import('../factory.ts');
    expect(createVectorStore().name).toBe('sqlite-vec');
    expect(getEmbeddingModels()['bge-m3'].adapter).toBe('sqlite-vec');
    process.env.ORACLE_VECTOR_DB = 'lancedb';
    expect(createVectorStore().name).toBe('lancedb');
    expect(getEmbeddingModels()['bge-m3'].adapter).toBe('lancedb');
  } finally {
    if (dataDir === undefined) delete process.env.ORACLE_DATA_DIR; else process.env.ORACLE_DATA_DIR = dataDir;
    if (engine === undefined) delete process.env.ORACLE_VECTOR_DB; else process.env.ORACLE_VECTOR_DB = engine;
    await rm(dir, { recursive: true });
  }
});
