/** Non-MATCH probes on the FTS5 UNINDEXED document id must go through fts-lookup.ts. */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '../..');

function violations(source: string): number[] {
  // Mask comments while keeping offsets/newlines, so diagnostics name the original line.
  const code = source.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/[^\n]*/gm,
    (comment) => comment.replace(/[^\n]/g, ' '));
  const lines = new Set<number>();
  const flag = (offset: number) => lines.add(code.slice(0, offset).split('\n').length);
  // Inspect SQL literals separately: a MATCH in another statement cannot exempt a lookup.
  for (const literal of code.matchAll(/`(?:\\[\s\S]|[^`])*`|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"/g)) {
    const sql = literal[0];
    if (/\boracle_fts\s+MATCH\b/i.test(sql)) continue;
    for (const table of sql.matchAll(/\b(?:FROM|JOIN)\s+oracle_fts\b(?:\s+(?:AS\s+)?(?!WHERE\b|ON\b|JOIN\b)(\w+))?/gi)) {
      const alias = table[1];
      const direct = /\b(?:FROM|DELETE\s+FROM)\s+oracle_fts\s+WHERE\s+id\b/i.test(sql);
      const id = alias ? `(?:${alias}\\.id|oracle_fts\\.id)` : 'oracle_fts\\.id';
      const join = new RegExp(`\\bON\\s+(?:${id}\\s*=|\\w+\\.id\\s*=\\s*${id}\\b)`, 'i');
      const where = new RegExp(`\\bWHERE\\s+(?:${id}|id)\\s*(?:=|IN\\b)`, 'i');
      if (direct || join.test(sql) || where.test(sql)) flag(literal.index + table.index);
    }
  }
  // Drizzle can express the same scan without a SQL literal.
  for (const match of code.matchAll(/\b(?:eq|inArray)\(oracleFts\.id\s*,/g)) flag(match.index);
  return [...lines].sort((a, b) => a - b);
}

test('source contains no non-MATCH FTS document-id scans', () => {
  const failures: string[] = [];
  for (const file of [...new Bun.Glob('**/*.ts').scanSync({ cwd: join(root, 'src') })].sort()) {
    if (file.includes('__tests__/') || file.endsWith('.test.ts') || file.startsWith('db/migrations/')) continue;
    for (const line of violations(readFileSync(join(root, 'src', file), 'utf8'))) failures.push(`src/${file}:${line}`);
  }
  expect(failures).toEqual([]);
});

test('guard detects both join directions, direct reads/deletes, and leaves MATCH alone', () => {
  for (const sql of [
    'SELECT f.content FROM docs d JOIN oracle_fts f ON f.id = d.id',
    'SELECT f.content FROM docs d LEFT JOIN oracle_fts f ON d.id = f.id',
    'SELECT f.content FROM oracle_fts f JOIN docs d ON d.id = f.id',
    'SELECT content FROM oracle_fts WHERE id IN (?)',
    'DELETE FROM oracle_fts WHERE id = ?',
  ]) expect(violations(`const query = \`${sql}\`;`)).toEqual([1]);
  expect(violations('const q = `SELECT f.id FROM oracle_fts f JOIN docs d ON f.id = d.id WHERE oracle_fts MATCH ?`;')).toEqual([]);
});
