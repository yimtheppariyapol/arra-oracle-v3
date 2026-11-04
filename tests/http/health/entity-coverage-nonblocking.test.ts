import { expect, test } from 'bun:test';
import { sqlite } from '../../../src/db/index.ts';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';
import { cachedEntityCoverageStats, stopEntityCoverageWorker } from '../../../src/search/entity-coverage.ts';
import { until } from '../../../src/search/__tests__/coverage-fixture.ts';

test('health does not wait for a slow coverage reader and pending stays healthy', async () => {
  const NativeWorker = globalThis.Worker;
  const workers: Worker[] = [];
  globalThis.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      const fixture = new URL('../../../src/search/__tests__/fixtures/slow-coverage-worker.ts', import.meta.url).href;
      super(String(url).endsWith('/entity-coverage-worker.ts') ? fixture : url, options);
      workers.push(this);
    }
  };
  // The same injected delay catches a regression to the synchronous default reader.
  const query = sqlite.query;
  let syncReads = 0;
  sqlite.query = ((...args: Parameters<typeof sqlite.query>) => {
    if (/FROM oracle_documents d|FROM sqlite_master WHERE name = \?/.test(args[0])) {
      if (syncReads++ === 0) Bun.sleepSync(1200);
    }
    return query(...args);
  }) as typeof sqlite.query;
  const app = createHealthRoutes({
    pluginCount: 1,
    vectorHealth: async () => ({ status: 'ok', engines: [], checked_at: 'now' }),
    vectorServerHealth: async () => ({ configured: false, status: 'unconfigured' }),
    embedderRuntime: async () => ({ status: 'connected', provider: 'local', source: 'env' }),
  });
  try {
    const started = performance.now();
    const response = await app.handle(new Request('http://local/api/health'));
    const body = await response.json();
    const elapsed = performance.now() - started;
    console.info(`health slow-reader elapsed: ${Math.round(elapsed)}ms (reader delay: 1200ms)`);
    expect(elapsed).toBeLessThan(400);
    expect(response.status).toBe(200);
    expect(body.entities.coverage).toMatchObject({ pending: true, docsIndexed: 0 });
    expect(body.subsystems.entities).toMatchObject({ status: 'healthy', data: { pending: true } });
    expect(body.healthStatus).toBe('healthy');
    expect(syncReads).toBe(0);
    expect(workers).toHaveLength(1);
    await until(() => !cachedEntityCoverageStats().pending);
    expect(cachedEntityCoverageStats().error).toBeUndefined();
  } finally {
    sqlite.query = query;
    globalThis.Worker = NativeWorker;
    stopEntityCoverageWorker();
    workers.forEach((worker) => worker.terminate());
  }
});
