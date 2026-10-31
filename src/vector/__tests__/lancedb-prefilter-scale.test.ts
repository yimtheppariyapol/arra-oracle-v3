import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('20k x 1024 seeded filtered and unfiltered recall@10 match sqlite-vec flat >= 0.98', async () => {
  // Separate process selects an extension-enabled SQLite before any other test opens a DB.
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '../../scripts/vector-eval/scale-20k.ts')],
    { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (exit !== 0) throw new Error(`Scale benchmark exit ${exit}: ${stdout}\n${stderr}`);
  const line = stdout.split('\n').find((value) => value.startsWith('SCALE_20K '));
  expect(line).toBeDefined();
  const result = JSON.parse(line!.slice('SCALE_20K '.length));
  console.log(JSON.stringify(result, null, 2));
  expect(result.rows).toBe(20_000); expect(result.dimensions).toBe(1024);
  expect(result.recall_at_10).toBeGreaterThanOrEqual(0.98);
  expect(result.filtered_recall_at_10).toBeGreaterThanOrEqual(0.98);
}, 180_000);
