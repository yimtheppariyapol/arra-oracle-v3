import { EmbeddingInputError, EmbeddingProviderUnavailableError } from '../vector/embedding-batch.ts';

/** Infrastructure failures must never exhaust a document's retry budget. */
export class VectorUnavailableError extends Error {}

export function isTransientVectorError(error: unknown): boolean {
  if (error instanceof EmbeddingInputError) return false;
  return error instanceof VectorUnavailableError
    || error instanceof EmbeddingProviderUnavailableError
    || /SQLITE_BUSY|database is locked|ECONN|ETIMEDOUT|ENET|EHOST|fetch|network|timeout|timed out|unavailable|overload|temporar|conflict|lock held|rate.limit|\b(429|50[0234])\b/i.test(String(error));
}

export async function retrySqliteBusy<T>(operation: () => T, retries = 5): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return operation(); }
    catch (error) {
      if (!/SQLITE_BUSY|database is locked/i.test(String(error)) || attempt >= retries) throw error;
      await Bun.sleep(25 * 2 ** attempt);
    }
  }
}
