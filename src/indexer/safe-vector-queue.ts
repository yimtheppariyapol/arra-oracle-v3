import type { OracleDbInput } from '../db/drizzle-input.ts';
import type { OracleDocument } from '../types.ts';
import { enqueueVectorReindexJobs, type ModelRegistry } from './reindex-state.ts';
import { isVectorEligible, productionVectorModels, vectorEligibilityConfig,
  type VectorEligibilityConfig } from './vector-eligibility.ts';

export function safeEnqueueVectorJobs(
  db: OracleDbInput,
  documents: OracleDocument[],
  changedIds: Set<string>,
  models: ModelRegistry,
  config: VectorEligibilityConfig = vectorEligibilityConfig(process.env),
) {
  const eligible = documents.filter((doc) => isVectorEligible({ ...doc, created_by: 'indexer' }, config));
  const production = productionVectorModels(models, config);
  try {
    return enqueueVectorReindexJobs(db, eligible, production, changedIds);
  } catch {
    return { queued: 0, skipped: 0, failed: eligible.length * Object.keys(production).length };
  }
}
