import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('tombstone reconciliation preserves memory and other non-indexer vectors', async () => {
  const h = await incrementalHarness();
  try {
    const foreign = ['memory:abc', 'entity:abc', 'learning_note:entity:oracle', 'imported-id'];
    await h.store.upsertVectors(foreign.map((id) => ({
      id, document: 'owned by another writer', metadata: {}, vector: Array(8).fill(0.5),
    })));
    h.put('learning_current', 'current document'); h.enqueue('learning_current');
    await h.run();
    await h.run();
    expect((await h.store.listDocumentIds()).sort()).toEqual([...foreign, 'learning_current'].sort());
    expect(h.sqlite.query("SELECT doc_id FROM indexing_jobs WHERE error = 'deleted'").all()).toEqual([]);
  } finally { await h.close(); }
});
