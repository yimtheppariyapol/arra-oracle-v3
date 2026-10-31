import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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

/** Immutable entries survive store rebuilds. Atomic rename prevents partial cache hits. */
export class EmbeddingCache {
  constructor(private readonly directory: string) {}

  async vectors(
    docs: VectorDocument[], provider: EmbeddingProvider, identity: EmbeddingIdentity,
    chunkerVersion = CHUNKER_VERSION,
  ): Promise<{ documents: Array<VectorDocument & { vector: number[] }>; embedded: number }> {
    const keys = docs.map((doc) => embeddingCacheKey(identity,
      provider.prepareText?.(doc.document, 'passage') ?? doc.document, chunkerVersion));
    const vectors = new Map<string, number[]>();
    const missing = new Map<string, string>();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (vectors.has(key) || missing.has(key)) continue;
      try {
        const vector: unknown = JSON.parse(await readFile(join(this.directory, key), 'utf8'));
        validateVector(vector, identity.dimensions);
        vectors.set(key, vector);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT'
          && !(error instanceof SyntaxError) && !String(error).includes('Invalid embedding')) throw error;
        missing.set(key, docs[i].document);
      }
    }
    if (missing.size) {
      const texts = [...missing.values()];
      const fresh = await (provider.embedPassageBatch?.(texts) ?? provider.embed(texts, 'passage'));
      if (fresh.length !== texts.length) throw new Error('Embedding batch cardinality mismatch');
      fresh.forEach((vector) => validateVector(vector, identity.dimensions));
      await mkdir(this.directory, { recursive: true });
      let i = 0;
      for (const key of missing.keys()) {
        const vector = fresh[i++];
        const destination = join(this.directory, key);
        const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(vector));
        await rename(temporary, destination);
        vectors.set(key, vector);
      }
    }
    return { documents: docs.map((doc, i) => ({ ...doc, vector: vectors.get(keys[i])! })), embedded: missing.size };
  }
}
