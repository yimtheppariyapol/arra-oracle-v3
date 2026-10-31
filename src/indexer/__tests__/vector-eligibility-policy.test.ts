import { expect, test } from 'bun:test';
import { isVectorEligible, vectorEligibilityConfig } from '../vector-eligibility.ts';

test('durable paths and DB-only provenance are eligible; transient and origin paths are excluded', () => {
  for (const source_file of ['ψ/memory/learnings/a.md', 'ψ/memory/retrospectives/a.md',
    'ψ/memory/resonance/a.md', 'ψ/learn/repo/notes.md', 'ψ/inbox/handoff/a.md',
    'repo/ψ/inbox/handoffs/a.md', '/repo/ψ/memory/learnings/a.md']) {
    expect(isVectorEligible({ source_file, created_by: 'indexer' })).toBe(true);
  }
  for (const source_file of ['ψ/inbox/results/a.md', 'ψ/inbox/research/a.md',
    'ψ/learn/repo/origin/a.ts', 'ψ/memory/origin/a.md', 'origin/ψ/memory/a.md', 'notψ/memory/a.md', 'README.md']) {
    expect(isVectorEligible({ source_file, created_by: 'indexer' })).toBe(false);
  }
  expect(isVectorEligible({ source_file: 'db-only', created_by: 'oracle_learn' })).toBe(true);
  expect(isVectorEligible({ source_file: 'db-only', created_by: null })).toBe(false);
  expect(isVectorEligible({ source_file: 'ψ/learn/origin/a.ts', created_by: 'oracle_learn' })).toBe(false);
  const config = vectorEligibilityConfig({ ORACLE_VECTOR_INCLUDE: 'ψ/inbox/results/**', ORACLE_VECTOR_EXCLUDE: '' });
  expect(isVectorEligible({ source_file: 'ψ/inbox/results/a.md' }, config)).toBe(true);
  expect(isVectorEligible({ source_file: 'ψ/memory/a.md' }, config)).toBe(false);
  expect(isVectorEligible({ source_file: 'ψ/learn/origin/a.ts' }, { ...config, include: ['**'] })).toBe(true);
});
