import { isVectorEligible, vectorEligibilityConfig } from '../../indexer/vector-eligibility.ts';
import { snapshotRows } from './snapshot.ts';

const config = vectorEligibilityConfig(process.env);
const registryFlag = process.argv.indexOf('--registered-models');
const registered = registryFlag < 0 ? ['bge-m3', 'nomic', 'qwen3']
  : (process.argv[registryFlag + 1] ?? '').split(',').filter(Boolean);
const sources = new Set<string>();
const eligibleSources = new Set<string>();
let chunks = 0, eligibleChunks = 0, dbOnly = 0, eligibleDbOnly = 0;
for await (const row of snapshotRows(false)) {
  chunks++;
  const source = `${row.tenant_id}:${row.source_file}`;
  sources.add(source);
  if (row.created_by !== null && row.created_by !== 'indexer') dbOnly++;
  if (isVectorEligible(row, config)) {
    eligibleChunks++; eligibleSources.add(source);
    if (row.created_by !== null && row.created_by !== 'indexer') eligibleDbOnly++;
  }
}
console.log('READ ONLY, active rows only; documents = distinct tenant + source; chunks = document IDs.');
console.log(`Registry assumption: ${registered.join(', ')} (override with --registered-models).`);
console.log(JSON.stringify({ documents: sources.size, chunks, eligibleDocuments: eligibleSources.size,
  eligibleChunks, dbOnlyChunks: dbOnly, eligibleDbOnlyChunks: eligibleDbOnly, config }, null, 2));
console.log('| Model | Today docs | Today chunks/jobs | Proposed docs | Proposed chunks/jobs |');
console.log('| --- | ---: | ---: | ---: | ---: |');
for (const model of new Set([...registered, ...config.models])) {
  const current = registered.includes(model);
  const enabled = current && config.models.includes(model);
  console.log(`| ${model} | ${current ? sources.size : 0} | ${current ? chunks : 0} | ${enabled ? eligibleSources.size : 0} | ${enabled ? eligibleChunks : 0} |`);
}
console.log('Counterfactual full enqueue; ignores current queue deduplication, performs no queue writes.');
