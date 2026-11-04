import { expect, test } from 'bun:test';
import { createEntityCoverageCache, entityCoverageIntervalMs } from '../entity-coverage-cache.ts';
import { coverageFixture } from './coverage-fixture.ts';

test('first coverage read returns a marked pending value without an error', () => {
  const fixture = coverageFixture();
  const cache = createEntityCoverageCache({ dbPath: fixture.dbPath });
  try {
    const pending = cache.get('tenant-a');
    expect(pending).toMatchObject({
      docsIndexed: 0, docsWithEntities: 0, docsMissingEntities: 0,
      ratio: 1, pending: true, tenantId: 'tenant-a',
    });
    expect(Number.isFinite(Date.parse(pending.checkedAt))).toBe(true);
    expect(pending.error).toBeUndefined();
    expect(cache.get('tenant-a')).toBe(pending);
  } finally { cache.stop(); fixture.close(); }
});

test('coverage refresh interval defaults to ten minutes and accepts a positive env override', () => {
  expect(entityCoverageIntervalMs({})).toBe(600_000);
  expect(entityCoverageIntervalMs({ ORACLE_ENTITY_COVERAGE_INTERVAL_MS: '50' })).toBe(50);
  for (const invalid of ['', '0', '-1', 'NaN', 'Infinity', '2147483648']) {
    expect(entityCoverageIntervalMs({ ORACLE_ENTITY_COVERAGE_INTERVAL_MS: invalid })).toBe(600_000);
  }
});
