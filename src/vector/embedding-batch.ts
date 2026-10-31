import type { EmbeddingProvider } from './types.ts';

/** A healthy provider rejected these inputs; the worker should bisect, even for HTTP 500. */
export class EmbeddingInputError extends Error {}
export class EmbeddingProviderUnavailableError extends Error {}

export async function embedHealthyBatch(
  provider: EmbeddingProvider, texts: string[], validate: (vectors: number[][], count: number) => void,
): Promise<number[][]> {
  const embed = (input: string[]) => provider.embedPassageBatch?.(input) ?? provider.embed(input, 'passage');
  try {
    const vectors = await embed(texts);
    validate(vectors, texts.length);
    return vectors;
  } catch (error) {
    // Exercise the same model/path with tiny known-good input, independent of the failed batch.
    try { validate(await embed(['health check']), 1); }
    catch (probeError) {
      throw new EmbeddingProviderUnavailableError(`Embedding provider unavailable: ${probeError}`, { cause: error });
    }
    throw new EmbeddingInputError(`Embedding input failed: ${error}`, { cause: error });
  }
}
