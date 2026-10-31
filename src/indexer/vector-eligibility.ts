/** Vector-only policy. FTS ingestion must never consult this module. */
export interface VectorDocumentSource {
  source_file: string;
  created_by?: string | null;
}

export interface VectorEligibilityConfig {
  include: readonly string[];
  exclude: readonly string[];
  models: readonly string[];
}

/** Canonical defaults; env lists replace, rather than extend, each default. */
export const DEFAULT_VECTOR_ELIGIBILITY: VectorEligibilityConfig = {
  include: ['ψ/memory/**', 'ψ/learn/**', 'ψ/inbox/handoff/**', 'ψ/inbox/handoffs/**'],
  exclude: ['**/origin/**'],
  models: ['bge-m3'],
};

type Env = Record<string, string | undefined>;

export function vectorEligibilityConfig(env: Env = {}): VectorEligibilityConfig {
  const list = (key: string, fallback: readonly string[]) => env[key] === undefined
    ? [...fallback] : env[key]!.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    include: list('ORACLE_VECTOR_INCLUDE', DEFAULT_VECTOR_ELIGIBILITY.include),
    exclude: list('ORACLE_VECTOR_EXCLUDE', DEFAULT_VECTOR_ELIGIBILITY.exclude),
    models: list('ORACLE_VECTOR_MODELS', DEFAULT_VECTOR_ELIGIBILITY.models),
  };
}

export function vectorSourcePath(source: string): string {
  const path = source.replaceAll('\\', '/').replace(/^\.\//, '');
  const segments = path.split('/');
  const psi = segments.indexOf('ψ');
  return psi < 0 ? path : segments.slice(psi).join('/');
}

export function isVectorEligible(
  doc: VectorDocumentSource,
  config: VectorEligibilityConfig = DEFAULT_VECTOR_ELIGIBILITY,
): boolean {
  const path = vectorSourcePath(doc.source_file);
  // Exclusions win, even for DB-only rows. Null provenance is legacy indexer data.
  if (config.exclude.some((glob) => new Bun.Glob(glob).match(path)
    || new Bun.Glob(glob).match(doc.source_file.replaceAll('\\', '/')))) return false;
  if (doc.created_by != null && doc.created_by !== 'indexer') return true;
  return config.include.some((glob) => new Bun.Glob(glob).match(path));
}

export function productionVectorModels<T>(
  models: Record<string, T>, config: VectorEligibilityConfig = DEFAULT_VECTOR_ELIGIBILITY,
): Record<string, T> {
  return Object.fromEntries(Object.entries(models).filter(([key]) => config.models.includes(key)));
}
