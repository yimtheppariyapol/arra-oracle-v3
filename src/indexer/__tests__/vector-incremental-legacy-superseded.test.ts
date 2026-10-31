import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('reconcile removes superseded legacy vectors absent from the manifest', async () => {
  const h = await incrementalHarness();
  try {
    h.put('learning_legacy', 'learning_legacy');
    await h.store.upsertVectors([{ id: 'learning_legacy', document: 'learning_legacy', metadata: {}, vector: Array(8).fill(0.5) }]);
    h.sqlite.exec("UPDATE oracle_documents SET superseded_by = 'next' WHERE id = 'learning_legacy'");
    await h.run();
    expect((await h.store.getStats()).count).toBe(0);
    expect(h.calls).toHaveLength(0);
  } finally { await h.close(); }
});
