import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('invalid metadata fails only its job while valid jobs commit', async () => {
  const h = await incrementalHarness();
  try {
    h.put('good', 'good'); h.put('bad', 'bad'); h.enqueue('good', 'bad');
    h.sqlite.query('UPDATE oracle_documents SET valid_time = ? WHERE id = ?').run('bad-date', 'bad');
    await h.run();
    expect((await h.store.getAllEmbeddings()).ids).toEqual(['good']);
    expect(h.sqlite.query("SELECT status FROM indexing_jobs WHERE doc_id = 'bad'").get()).toEqual({ status: 'error' });
  } finally { await h.close(); }
});
