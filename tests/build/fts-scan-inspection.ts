/** Preserve offsets while ignoring comments/values, including semicolons inside them. */
const blank = (text: string) => text.replace(/[^\n]/g, ' ');

export function sqlViolations(source: string, offset = 0): number[] {
  const code = source.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'/g, blank);
  const offsets = new Set<number>();
  for (const statement of code.matchAll(/[^;]+/g)) {
    const sql = statement[0];
    if (/\boracle_fts\s+MATCH\b/i.test(sql)) continue;
    const flag = (index: number) => offsets.add(offset + statement.index + index);
    for (const count of sql.matchAll(/\bCOUNT\s*\([^)]*\)[\s\S]*?\bFROM\s+oracle_fts\b/gi)) flag(count.index);
    for (const table of sql.matchAll(/\b(?:FROM|JOIN|UPDATE(?:\s+OR\s+\w+)?)\s+oracle_fts\b(?:\s+(?:AS\s+)?(?!WHERE\b|SET\b|ON\b|JOIN\b|LEFT\b|RIGHT\b|INNER\b|CROSS\b|ORDER\b|GROUP\b|LIMIT\b)(\w+))?/gi)) {
      const alias = table[1];
      const id = alias ? `(?:${alias}\\.id|oracle_fts\\.id|(?<![\\w.])id)` : '(?:oracle_fts\\.id|(?<![\\w.])id)';
      const conditions = sql.match(/\b(?:WHERE|ON)\b[\s\S]*/i)?.[0] ?? '';
      const predicate = new RegExp(`(?:\\b${id}\\s*(?:=|IN\\b)|=\\s*${id}\\b)`, 'i');
      if (predicate.test(conditions)) flag(table.index);
    }
  }
  return [...offsets];
}

export function violations(source: string, rawSql = false): number[] {
  const offsets = rawSql ? sqlViolations(source) : [];
  if (!rawSql) {
    // Consume comments and literals together so comment-like text inside strings stays SQL.
    const tokens = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\[\s\S]|[^`])*`|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"/g;
    const code = source.replace(tokens, (token) => token.startsWith('/') ? blank(token) : token);
    for (const literal of code.matchAll(tokens)) {
      if (literal[0].startsWith('/')) continue;
      offsets.push(...sqlViolations(literal[0].slice(1, -1), literal.index + 1));
    }
    for (const match of code.matchAll(/\bcount\(\s*['"`]oracle_fts['"`]\s*\)|\b(?:eq|inArray)\(oracleFts\.id\s*,/g)) {
      offsets.push(match.index);
    }
  }
  return [...new Set(offsets.map((offset) => source.slice(0, offset).split('\n').length))].sort((a, b) => a - b);
}
