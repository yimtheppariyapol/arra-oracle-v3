import type { EntityCoverageStats } from './entity-coverage-reader.ts';

export type CoverageRequest = { dbPath: string; tenantId?: string };
export type CoverageResult = { tenantId?: string; value: EntityCoverageStats };

export function pendingEntityCoverage(tenantId?: string): EntityCoverageStats {
  return {
    docsIndexed: 0, docsWithEntities: 0, docsMissingEntities: 0, ratio: 1,
    checkedAt: new Date().toISOString(), pending: true,
    ...(tenantId ? { tenantId } : {}),
  };
}

export function entityCoverageIntervalMs(env = process.env): number {
  const ms = Number(env.ORACLE_ENTITY_COVERAGE_INTERVAL_MS);
  return Number.isFinite(ms) && ms > 0 && ms <= 2_147_483_647 ? ms : 10 * 60_000;
}

export function createEntityCoverageCache(options: {
  dbPath: string;
  intervalMs?: number;
  createWorker?: () => Worker;
}) {
  const values = new Map<string | undefined, EntityCoverageStats>();
  const inFlight = new Set<string | undefined>();
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  function fail(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    for (const tenantId of inFlight) {
      const { pending, ...empty } = pendingEntityCoverage(tenantId);
      values.set(tenantId, { ...empty, error: message });
    }
    inFlight.clear();
    worker?.terminate();
    worker = undefined;
  }

  function refresh(tenantId?: string) {
    if (stopped || inFlight.has(tenantId)) return;
    inFlight.add(tenantId);
    try {
      if (!worker) {
        const active = options.createWorker?.() ?? new Worker(new URL('./entity-coverage-worker.ts', import.meta.url).href);
        worker = active;
        active.unref();
        active.onmessage = (event: MessageEvent<CoverageResult>) => {
          if (worker !== active || stopped) return;
          values.set(event.data.tenantId, event.data.value);
          inFlight.delete(event.data.tenantId);
        };
        active.onerror = (event) => {
          event.preventDefault();
          if (worker === active) fail(event.message);
        };
        active.addEventListener('close', () => {
          if (worker === active) fail('entity coverage worker closed');
        });
      }
      worker.postMessage({ dbPath: options.dbPath, tenantId } satisfies CoverageRequest);
    } catch (error) { fail(error); }
  }

  return {
    get(tenantId?: string): EntityCoverageStats {
      if (!values.has(tenantId)) {
        values.set(tenantId, pendingEntityCoverage(tenantId));
        if (!stopped) {
          timer ??= setInterval(() => {
            for (const tenant of values.keys()) refresh(tenant);
          }, options.intervalMs ?? entityCoverageIntervalMs());
          timer.unref();
          refresh(tenantId);
        }
      }
      return values.get(tenantId)!;
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      const active = worker;
      worker = undefined;
      active?.terminate();
      inFlight.clear();
    },
  };
}
