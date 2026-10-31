interface SupervisorOptions {
  isShuttingDown(): boolean;
  onError(error: unknown): void;
  retryMs?: number;
}

/** Keep daemon worker failures observed and restartable, including writer-lock timeouts. */
export async function superviseWorker(start: () => Promise<unknown>, options: SupervisorOptions): Promise<void> {
  let failures = 0;
  while (!options.isShuttingDown()) {
    await Promise.resolve().then(start).catch((error) => {
      options.onError(error);
    });
    if (options.isShuttingDown()) return;
    await Bun.sleep(Math.min(30_000, (options.retryMs ?? 1000) * 2 ** Math.min(failures++, 5)));
  }
}
