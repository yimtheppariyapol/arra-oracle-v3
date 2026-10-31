import { expect, test } from 'bun:test';
import { getEmbeddingModels } from '../../src/vector/factory.ts';

test('vector store model registry returns LanceDB defaults when config is absent', () => {
  const models = getEmbeddingModels(null);

  expect(Object.keys(models).sort()).toEqual(['bge-m3', 'nomic', 'qwen3']);
  expect(Object.values(models).every((model) => model.adapter === 'lancedb')).toBe(true);
});
