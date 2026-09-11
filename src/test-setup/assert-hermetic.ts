import path from 'node:path';

/**
 * Throw if any resolved path lies outside the throwaway test root.
 *
 * Checks that every path is INSIDE the root, not that it avoids a list of known-real paths: a
 * denylist misses the next real path someone adds, an allowlist of one directory does not.
 */
export function assertHermetic(
  paths: Record<string, string>,
  root: string,
  realHome: string,
  hint = '',
): void {
  const inside = path.resolve(root) + path.sep;
  const outside = Object.entries(paths).filter(([, p]) => !(path.resolve(p) + path.sep).startsWith(inside));
  if (outside.length) {
    const list = outside.map(([k, p]) => `${k}=${p}`).join(', ');
    throw new Error(
      `hermetic test setup: ${list} is outside the throwaway root ${root}. ` +
      `Refusing to run tests that could write to real data under ${realHome}. ${hint}`.trim(),
    );
  }
}
