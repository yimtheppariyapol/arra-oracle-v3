import { readdir, stat, unlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';

type Entry = { bytes: number; time: number };

/** Load disk accounting once, then track hits and writes without a directory scan per batch. */
export class EmbeddingCacheLru {
  private entries = new Map<string, Entry>();
  private total = 0;
  private clock = 0;
  private loaded?: Promise<void>;
  constructor(private directory: string, private maxBytes: number) {}

  prepare(): Promise<void> { return this.loaded ??= this.load(); }

  async touch(key: string, bytes: number): Promise<void> {
    const time = this.clock = Math.max(Date.now(), this.clock + 1);
    await utimes(join(this.directory, key), time / 1000, time / 1000);
    this.total += bytes - (this.entries.get(key)?.bytes ?? 0);
    this.entries.set(key, { bytes, time });
  }

  async prune(): Promise<void> {
    if (this.total <= this.maxBytes) return;
    for (const [key, entry] of [...this.entries].sort((a, b) => a[1].time - b[1].time || a[0].localeCompare(b[0]))) {
      if (this.total <= this.maxBytes) break;
      try { await unlink(join(this.directory, key)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      // Another batch sharing this instance may have touched the entry during unlink.
      if (this.entries.get(key) === entry) { this.total -= entry.bytes; this.entries.delete(key); }
    }
  }

  private async load(): Promise<void> {
    let names: string[];
    try { names = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const name of names) {
      if (!/^[a-f0-9]{64}(?:\.f32)?$/.test(name)) continue;
      try {
        const info = await stat(join(this.directory, name));
        this.entries.set(name, { bytes: info.size, time: info.mtimeMs });
        this.total += info.size;
        this.clock = Math.max(this.clock, Math.ceil(info.mtimeMs));
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
}
