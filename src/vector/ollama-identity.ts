import type { EmbeddingIdentity } from './embedding-cache.ts';

/** Resolve mutable Ollama tags to immutable weights; fail closed instead of sharing stale cache entries. */
export async function ollamaIdentity(baseUrl: string, model: string, dimensions: number): Promise<EmbeddingIdentity> {
  const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Cannot resolve Ollama digest (${response.status})`);
  const data = await response.json() as { models?: { name: string; model?: string; digest: string }[] };
  const canonical = model.includes(':') ? model : `${model}:latest`;
  const entry = data.models?.find((row) => [row.name, row.model].some((name) => name === model || name === canonical));
  if (!entry?.digest) throw new Error(`No Ollama digest for ${model}`);
  return { model: `ollama:${model}`, digest: entry.digest, dimensions };
}
