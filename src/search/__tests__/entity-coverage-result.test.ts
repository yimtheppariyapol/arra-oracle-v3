import { expect, test } from 'bun:test';
import { createEntityCoverageCache } from '../entity-coverage-cache.ts';
import { coverageFixture, until } from './coverage-fixture.ts';

test('readonly worker results replace pending coverage and remain isolated by tenant', async () => {
  const fixture = coverageFixture();
  const cache = createEntityCoverageCache({ dbPath: fixture.dbPath });
  try {
    expect(cache.get('tenant-a').pending).toBe(true);
    expect(cache.get('tenant-b').pending).toBe(true);
    await until(() => !cache.get('tenant-a').pending && !cache.get('tenant-b').pending);
    expect(cache.get('tenant-a')).toMatchObject({
      docsIndexed: 1, docsWithEntities: 1, docsMissingEntities: 0, ratio: 1, tenantId: 'tenant-a',
    });
    expect(cache.get('tenant-b')).toMatchObject({ docsIndexed: 0, tenantId: 'tenant-b' });
    expect(cache.get('tenant-a').error).toBeUndefined();
  } finally { cache.stop(); fixture.close(); }
});
