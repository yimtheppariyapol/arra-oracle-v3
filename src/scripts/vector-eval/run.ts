import { prepareCorpus } from './prepare.ts';
import { prepareQueries, validateQueries, type Query } from './queries.ts';
import { ftsIndex } from './ranking.ts';
import { localModels } from './embeddings.ts';
import { evaluateModel, summarize, type ModelResult } from './evaluate.ts';
import { writeReport } from './report.ts';
import { shuffleTruth } from './shuffle.ts';

const args = process.argv.slice(2);
const negative = args.includes('--negative-control');
const prefix = negative ? 'eval-out/negative' : 'eval-out';
function value(flag: string, fallback: string) {
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return args[i + 1];
}
async function run() {
  const size = Number(value('--sample', '6000'));
  const batch = Number(value('--batch', '16'));
  if (!Number.isInteger(size) || size < 100 || size > 6000) throw new Error('Sample must be 100..6000 for bounded memory');
  if (!Number.isInteger(batch) || batch < 1 || batch > 64) throw new Error('Batch must be 1..64');
  const corpus = await prepareCorpus(size);
  if (new Set(corpus.map((row) => row.id)).size !== corpus.length) throw new Error('Duplicate corpus chunk IDs');
  let queries: Query[];
  const queryFile = value('--queries', '');
  if (queryFile) {
    if (!queryFile.startsWith('eval-out/')) throw new Error('Query input must live under eval-out/');
    queries = (await Bun.file(queryFile).text()).trim().split('\n').map((line) => JSON.parse(line));
  } else queries = await prepareQueries(corpus);
  if (negative && !queryFile) {
    queries = shuffleTruth(queries, corpus);
    await Bun.write('eval-out/queries-shuffled.jsonl', queries.map((q) => JSON.stringify(q)).join('\n') + '\n');
  }
  validateQueries(queries, corpus, !negative);
  const index = await ftsIndex(corpus);
  const predictions: string[] = [];
  const savePredictions = async (method: string, rankings: string[][]) => {
    for (const [i, ranking] of rankings.entries()) predictions.push(JSON.stringify({
      method, query: queries[i].id, top100: ranking.slice(0, 100), relevant: queries[i].relevant }));
  };
  try {
    const fts = queries.map((query) => index.search(query.text));
    await savePredictions('FTS5', fts);
    const rows = summarize('FTS5', queries, fts);
    if (negative) {
      const overall = rows.find((row) => row.category === 'overall')!;
      console.log(`Shuffled FTS control: nDCG@10=${overall.ndcg10.toFixed(6)}, recall@10=${overall.recall10.toFixed(6)}, MRR=${overall.mrr.toFixed(6)}`);
      if (overall.ndcg10 >= 0.05 || overall.recall10 >= 0.05 || overall.mrr >= 0.05) {
        throw new Error('Shuffled FTS control is not near zero (<0.05 required)');
      }
    }
    let registry = new Map<string, string>(), unavailable: string | undefined;
    try { registry = await localModels(); }
    catch (error) { unavailable = `Local Ollama unavailable: ${String(error)}`; }
    const models = ['bge-m3', 'embeddinggemma'];
    if (registry.has('qwen3-embedding:0.6b')) models.push('qwen3-embedding:0.6b');
    const outcomes: ModelResult[] = [];
    for (const model of models) {
      const revision = registry.get(model);
      const outcome = revision
        ? await evaluateModel(model, revision, corpus, queries, fts, batch, rows, savePredictions)
        : { model, status: 'unavailable', error: unavailable ?? 'Required model is not installed' };
      outcomes.push(outcome);
      console.log(`${model}: ${outcome.status}${outcome.error ? ` — ${outcome.error}` : ''}`);
    }
    await Bun.write(`${prefix}/results.json`, JSON.stringify({ rows, models: outcomes, negative }, null, 2));
    await Bun.write(`${prefix}/predictions.jsonl`, predictions.join('\n') + '\n');
    await writeReport(`${prefix}/report.md`, rows, outcomes, negative);
    console.log(await Bun.file(`${prefix}/report.md`).text());
    if (outcomes.some((model) => model.status !== 'complete')) process.exitCode = 1;
  } finally { index.close(); }
}

try { await run(); }
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await Bun.write(`${prefix}/report.md`, `# Evaluation incomplete\n\n${message}\n\nNo model-selection claim is valid for this failed run.\n`);
  console.error(message);
  process.exitCode = 1;
}
