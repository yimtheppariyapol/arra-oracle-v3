import { expect, test } from 'bun:test';
import { productionVectorModels, vectorEligibilityConfig } from '../vector-eligibility.ts';

test('production defaults to bge-m3; an explicit list or empty list replaces it', () => {
  const models = { 'bge-m3': { collection: 'a' }, nomic: { collection: 'b' }, qwen3: { collection: 'c' } };
  expect(productionVectorModels(models)).toEqual({ 'bge-m3': models['bge-m3'] });
  expect(productionVectorModels(models, vectorEligibilityConfig({ ORACLE_VECTOR_MODELS: ' qwen3,missing,qwen3 ' })))
    .toEqual({ qwen3: models.qwen3 });
  expect(productionVectorModels(models, vectorEligibilityConfig({ ORACLE_VECTOR_MODELS: '' }))).toEqual({});
});
