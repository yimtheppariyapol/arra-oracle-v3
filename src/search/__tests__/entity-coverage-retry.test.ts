import { expect, test } from 'bun:test';
import { createEntityCoverageCache } from '../entity-coverage-cache.ts';
import { coverageFixture, until } from './coverage-fixture.ts';

test('coverage errors stay cached across requests and retry on the next interval', async () => {
  const fixture = coverageFixture();
  let posts = 0;
  // Start with a missing file, then switch the same worker request to the real fixture.
  let dbPath = fixture.dbPath + '.missing';
  const cache = createEntityCoverageCache({
    dbPath, intervalMs: 500,
    createWorker: () => {
      const worker = new Worker(new URL('../entity-coverage-worker.ts', import.meta.url).href);
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (message) => { posts++; post({ ...message, dbPath }); };
      return worker;
    },
  });
  try {
    cache.get('tenant-a');
    await until(() => Boolean(cache.get('tenant-a').error));
    const error = cache.get('tenant-a');
    expect(error.pending).toBeUndefined();
    expect(posts).toBe(1);
    dbPath = fixture.dbPath;
    for (let i = 0; i < 100; i++) expect(cache.get('tenant-a')).toBe(error);
    expect(posts).toBe(1);
    await until(() => cache.get('tenant-a').docsIndexed === 1);
    expect(posts).toBe(2);
    expect(cache.get('tenant-a').error).toBeUndefined();
  } finally { cache.stop(); fixture.close(); }
});
