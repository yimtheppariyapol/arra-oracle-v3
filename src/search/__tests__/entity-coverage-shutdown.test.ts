import { expect, test } from 'bun:test';
import { coverageFixture } from './coverage-fixture.ts';

test('coverage worker and interval do not keep an otherwise idle process alive', async () => {
  const fixture = coverageFixture();
  const cacheUrl = new URL('../entity-coverage-cache.ts', import.meta.url).href;
  const workerUrl = new URL('./fixtures/slow-coverage-worker.ts', import.meta.url).href;
  const script = `
    import { createEntityCoverageCache } from ${JSON.stringify(cacheUrl)};
    const cache = createEntityCoverageCache({
      dbPath: ${JSON.stringify(fixture.dbPath)},
      createWorker: () => new Worker(${JSON.stringify(workerUrl)}, { ref: true }),
    });
    console.log(cache.get('tenant-a').pending);
  `;
  const child = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' });
  const timeout = setTimeout(() => child.kill(), 2000);
  try {
    expect(await child.exited).toBe(0);
    expect((await new Response(child.stdout).text()).trim()).toBe('true');
    expect(await new Response(child.stderr).text()).toBe('');
  } finally { clearTimeout(timeout); child.kill(); fixture.close(); }
});
