import { expect, test } from 'bun:test';
import { detectDefaultVectorBackend, DEFAULT_VECTOR_COLLECTION } from '../../config/defaults.ts';
test('unconfigured installs retain sqlite-vec and LanceDB requires explicit selection', () => {
  expect(detectDefaultVectorBackend().engine).toBe('sqlite-vec');
  expect(DEFAULT_VECTOR_COLLECTION.adapter).toBe('sqlite-vec');
  expect(detectDefaultVectorBackend({ envEngine: 'lancedb' }).engine).toBe('lancedb');
  expect(detectDefaultVectorBackend({ configSource: 'file', configuredEngine: 'lancedb' }).engine).toBe('lancedb');
});
