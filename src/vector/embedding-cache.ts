import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { EmbeddingCacheLru } from './embedding-cache-lru.ts';
import { join } from 'node:path';
import type { EmbeddingProvider, VectorDocument } from './types.ts';

export const CHUNKER_VERSION = 'paragraph-800-v1';
export interface EmbeddingIdentity { model: string; digest: string; dimensions: number }

export function embeddingCacheKey(identity: EmbeddingIdentity, preparedText: string, chunkerVersion: string): string {
  return new Bun.CryptoHasher('sha256').update(JSON.stringify([
    identity.model, identity.digest, preparedText, identity.dimensions, chunkerVersion,
  ])).digest('hex');
}

export function validateVector(vector: unknown, dimensions: number): asserts vector is number[] {
  if (!Array.isArray(vector) || vector.length !== dimensions || !vector.every(Number.isFinite)) {
    throw new Error(`Invalid embedding: expected ${dimensions} finite dimensions`);
  }
}

/** Atomic float32 entries, bounded by an LRU byte budget (default 1 GiB). */
export class EmbeddingCache {
  private budget: EmbeddingCacheLru;
  constructor(private readonly directory: string, private readonly maxBytes = 1024 * 1024 * 1024) {
    if (!Number.isFinite(maxBytes) || maxBytes < 0) throw new Error('Invalid embedding cache byte cap');
    this.budget = new EmbeddingCacheLru(directory, maxBytes);
  }

  async vectors(
    docs: VectorDocument[], provider: EmbeddingProvider, identity: EmbeddingIdentity,
    chunkerVersion = CHUNKER_VERSION,
  ): Promise<{ documents: Array<VectorDocument & { vector: number[] }>; embedded: number }> {
    await this.budget.prepare();
    const keys = docs.map((doc) => embeddingCacheKey(identity,
      provider.prepareText?.(doc.document, 'passage') ?? doc.document, chunkerVersion));
    const vectors = new Map<string, number[]>();
    const missing = new Map<string, string>();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (vectors.has(key) || missing.has(key)) continue;
      const filename = `${key}.f32`;
      const file = join(this.directory, filename);
      try {
        const bytes = await readFile(file);
        if (bytes.byteLength !== identity.dimensions * 4) throw new Error('Invalid embedding cache size');
        const vector = Array.from({ length: identity.dimensions }, (_, i) => bytes.readFloatLE(i * 4));
        validateVector(vector, identity.dimensions);
        vectors.set(key, vector);
        await this.budget.touch(filename, bytes.byteLength);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !String(error).includes('Invalid embedding')) throw error;
        missing.set(key, docs[i].document);
      }
    }
    if (missing.size) {
      const texts = [...missing.values()];
      let fresh: number[][];
      try { fresh = await (provider.embedPassageBatch?.(texts) ?? provider.embed(texts, 'passage')); }
      catch (error) {
        if (/\b(400|422)\b|invalid input/i.test(String(error))) throw error;
        throw new Error(`Embedding provider unavailable: ${error}`, { cause: error });
      }
      if (fresh.length !== texts.length) throw new Error('Embedding batch cardinality mismatch');
      fresh.forEach((vector) => validateVector(vector, identity.dimensions));
      await mkdir(this.directory, { recursive: true });
      let i = 0;
      for (const key of missing.keys()) {
        const vector = fresh[i++];
        const filename = `${key}.f32`;
        const destination = join(this.directory, filename);
        const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
        const bytes = Buffer.alloc(vector.length * 4);
        vector.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
        const stored = Array.from({ length: vector.length }, (_, i) => bytes.readFloatLE(i * 4));
        validateVector(stored, identity.dimensions);
        await writeFile(temporary, bytes);
        await rename(temporary, destination);
        await this.budget.touch(filename, bytes.byteLength);
        vectors.set(key, stored);
      }
    }
    await this.budget.prune();
    return { documents: docs.map((doc, i) => ({ ...doc, vector: vectors.get(keys[i])! })), embedded: missing.size };
  }
}
