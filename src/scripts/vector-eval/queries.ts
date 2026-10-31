import { language, type Chunk } from './snapshot.ts';
import { monitorResources } from './resources.ts';

export interface Query {
  id: string;
  text: string;
  category: 'english' | 'thai' | 'code' | 'thai-to-english' | 'english-to-thai';
  relevant: string[];
  derivation: string;
}

function excerpt(row: Chunk, target: 'thai' | 'english'): string | undefined {
  const lines = row.content.split('\n').map((line) => line.replace(/^#+\s*|^[-*]\s*/g, '').trim());
  return lines.filter((line) => line.length >= 25 && !/^(Search expansions:|concepts:|source:|tags:|created:)/i.test(line))
    .map((line) => line.slice(0, 180)).find((line) => language(line) === target
      && (target === 'thai' || !/[\u0e00-\u0e7f]/.test(line)));
}

export function nativeQueries(corpus: Chunk[]): Query[] {
  const result: Query[] = [];
  const used = new Set<string>();
  for (const category of ['english', 'thai', 'code'] as const) {
    const needed = category === 'code' ? 20 : 40;
    let count = 0;
    for (const row of corpus) {
      if (count === needed) break;
      let text: string | undefined;
      if (category === 'code') {
        const identifiers = row.content.match(/\b(?:[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+|[a-z]+(?:[A-Z][a-z0-9]+)+|[a-z]+(?:_[a-z0-9]+)+)\b/g);
        text = identifiers ? [...new Set(identifiers)].slice(0, 3).join(' ') : undefined;
      } else text = excerpt(row, category);
      if (!text || used.has(`${category}:${text}`)) continue;
      used.add(`${category}:${text}`);
      result.push({ id: `${category}-${++count}`, text, category,
        relevant: corpus.filter((other) => category === 'code'
          ? text!.split(' ').every((identifier) => new RegExp(`\\b${identifier}\\b`).test(other.content))
          : other.content === row.content).map((other) => other.id),
        derivation: category === 'code' ? 'Identifiers copied from the relevant chunk; all exact occurrences labelled'
          : 'Heading or sentence excerpt from the relevant chunk; exact duplicate chunks also labelled' });
    }
    if (count < needed) throw new Error(`Only ${count} ${category} queries available; need ${needed}`);
  }
  return result;
}

async function translate(text: string, target: 'Thai' | 'English'): Promise<string> {
  const resources = await monitorResources();
  try {
    resources.check();
    const response = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ model: 'qwen2.5:3b', stream: false, keep_alive: 0,
        prompt: `Translate the following retrieval query into ${target}. Return only the translation.\n${text}`,
        options: { temperature: 0, num_ctx: 1024, num_predict: 160, num_batch: 32 } }),
    });
    if (!response.ok) throw new Error(`Translation unavailable (${response.status}): ${await response.text()}`);
    const data = await response.json() as { response: string };
    resources.check();
    const translated = data.response?.trim();
    if (!translated || language(translated) !== (target === 'Thai' ? 'thai' : 'english')) {
      throw new Error('Translation did not produce the requested language');
    }
    return translated;
  } finally { await resources.stop(); }
}

export async function prepareQueries(corpus: Chunk[]): Promise<Query[]> {
  const native = nativeQueries(corpus);
  const curated = Bun.file('eval-out/cross-language.jsonl');
  const cross: Query[] = await curated.exists()
    ? (await curated.text()).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  if (!cross.length) {
    for (const source of ['english', 'thai'] as const) {
      for (const query of native.filter((q) => q.category === source).slice(0, 10)) {
        const target = source === 'english' ? 'Thai' : 'English';
        cross.push({ ...query, id: `cross-${query.id}`, text: await translate(query.text, target),
          category: source === 'english' ? 'thai-to-english' : 'english-to-thai',
          derivation: 'Local qwen2.5:3b translation of a known-item excerpt; unjudged translation proxy' });
      }
    }
    await Bun.write(curated, cross.map((query) => JSON.stringify(query)).join('\n') + '\n');
  }
  const queries = [...native, ...cross];
  validateQueries(queries, corpus);
  await Bun.write('eval-out/queries.jsonl', queries.map((query) => JSON.stringify(query)).join('\n') + '\n');
  return queries;
}

export function validateQueries(queries: Query[], corpus: Chunk[], checkGrounding = true) {
  if (queries.length < 100) throw new Error('At least 100 known-item queries required');
  const ids = new Set<string>();
  const chunks = new Map(corpus.map((row) => [row.id, row]));
  for (const query of queries) {
    if (!query.id || ids.has(query.id) || !query.text?.trim() || !query.relevant?.length) throw new Error('Invalid query');
    ids.add(query.id);
    if (query.relevant.some((id) => !chunks.has(id))) throw new Error(`Ground truth outside corpus: ${query.id}`);
    const crossThai = query.category === 'thai-to-english';
    const crossEnglish = query.category === 'english-to-thai';
    if ((crossThai || query.category === 'thai') && language(query.text) !== 'thai') throw new Error('Expected Thai query');
    if ((crossEnglish || query.category === 'english') && language(query.text) !== 'english') throw new Error('Expected English query');
    if (checkGrounding && crossThai && query.relevant.some((id) => /[\u0e00-\u0e7f]/.test(chunks.get(id)!.content))) {
      throw new Error('Thai-to-English ground truth must have no Thai text');
    }
    if (checkGrounding && crossEnglish && query.relevant.some((id) => language(chunks.get(id)!.content) !== 'thai')) {
      throw new Error('English-to-Thai ground truth must be Thai dominant');
    }
  }
  for (const category of ['english', 'thai', 'code', 'thai-to-english', 'english-to-thai']) {
    if (!queries.some((q) => q.category === category)) throw new Error(`Missing category: ${category}`);
  }
}
