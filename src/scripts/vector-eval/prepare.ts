import { mkdir } from 'fs/promises';
import { createHash } from 'crypto';
import { vectorEligibilityConfig } from '../../indexer/vector-eligibility.ts';
import { language, sampleCorpus } from './snapshot.ts';

export async function prepareCorpus(size: number) {
  await mkdir('eval-out', { recursive: true });
  const file = Bun.file('eval-out/corpus.jsonl');
  const prior = await Bun.file('eval-out/corpus-stats.json').json().catch(() => ({}));
  const policy = JSON.stringify(vectorEligibilityConfig(process.env));
  let snapshotAt = prior.snapshotAt;
  let rows = await file.exists()
    ? (await file.text()).trim().split('\n').map((line) => JSON.parse(line))
    : [];
  if (rows.length !== size || prior.policy !== policy || prior.format !== 'utf8-stream-v2') {
    rows = await sampleCorpus(size);
    snapshotAt = new Date().toISOString();
    await Bun.write(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  }
  const strata: Record<string, number> = {};
  let thai = 0, hasThai = 0;
  for (const row of rows) {
    strata[row.category] = (strata[row.category] ?? 0) + 1;
    if (language(row.content) === 'thai') thai++;
    if (/[\u0e00-\u0e7f]/.test(row.content)) hasThai++;
  }
  const info = { chunks: rows.length, strata, thaiDominant: thai, englishDominant: rows.length - thai,
    snapshotAt, policy, format: 'utf8-stream-v2',
    sha256: createHash('sha256').update(await file.text()).digest('hex'),
    thaiRatio: thai / rows.length, containsThai: hasThai,
    languageRule: 'Thai letters > Latin letters = Thai dominant; containsThai also reported; other scripts not separately classified',
    snapshot: 'One SELECT over sqlite3 mode=ro, active rows with FTS text; deterministic reservoir seed 20261031' };
  await Bun.write('eval-out/corpus-stats.json', JSON.stringify(info, null, 2) + '\n');
  return rows as import('./snapshot.ts').Chunk[];
}

if (import.meta.main) {
  await prepareCorpus(Number(process.argv[2] ?? 6000));
  console.log(await Bun.file('eval-out/corpus-stats.json').text());
}
