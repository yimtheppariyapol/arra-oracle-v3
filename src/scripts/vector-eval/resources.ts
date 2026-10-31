const LIMIT = 4 * 1024 ** 3;

export async function monitorResources() {
  let clientPeak = process.memoryUsage().rss;
  let ollamaPeak = 0;
  let unavailable: string | undefined;
  let violation: string | undefined;
  let pending: Promise<void> | null = null;
  const measure = async () => {
    try {
      clientPeak = Math.max(clientPeak, process.memoryUsage().rss);
      if (clientPeak > LIMIT) violation = 'Eval client exceeded 4 GiB RSS';
      if (!unavailable) {
        const proc = Bun.spawn(['ps', '-axo', 'rss=,comm='], { stdout: 'pipe', stderr: 'pipe' });
        const [output, error] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
        if (await proc.exited !== 0) unavailable = error.trim() || 'ps unavailable';
        else {
          for (const line of output.split('\n').filter((line) => /ollama/i.test(line))) {
            const bytes = Number(line.trim().split(/\s+/)[0]) * 1024;
            ollamaPeak = Math.max(ollamaPeak, bytes);
            if (bytes > LIMIT) violation = 'An Ollama process exceeded 4 GiB RSS; no further batches allowed';
          }
        }
      }
    } catch (error) { unavailable = String(error); }
  };
  const sample = (): Promise<void> => {
    pending ??= measure().finally(() => { pending = null; });
    return pending;
  };
  await sample();
  const timer = setInterval(() => { void sample(); }, 1000);
  return {
    check() {
      if (violation) throw new Error(violation);
      if (unavailable) throw new Error(`Cannot enforce Ollama RSS limit: ${unavailable}`);
    },
    async stop() {
      clearInterval(timer);
      await pending;
      await sample();
      return { clientPeakMiB: clientPeak / 1024 ** 2,
        ollamaPeakMiB: unavailable || !ollamaPeak ? null : ollamaPeak / 1024 ** 2,
        rssNote: unavailable ?? 'ps sampled each second; largest single Ollama process, not aggregate', violation };
    },
  };
}
