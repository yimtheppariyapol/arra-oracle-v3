import { expect, test } from 'bun:test';
import { connect } from '@lancedb/lancedb';
import { prefilterHarness, queryVector } from './lancedb-prefilter-harness.ts';

test('legacy duplicate ids keep the newest timestamp and log dropped rows', async () => {
  const h = await prefilterHarness();
  const warn = console.warn; const logs: string[] = [];
  console.warn = (...args) => { logs.push(args.join(' ')); };
  try {
    await h.store.deleteCollection();
    const db = await connect(h.directory);
    await db.createTable('filtered', [
      { id: 'a', text: 'new', vector: queryVector, metadata: JSON.stringify({ updated_at: 20, project: 'p' }) },
      { id: 'a', text: 'old', vector: queryVector, metadata: JSON.stringify({ updated_at: 10 }) },
      { id: 'b', text: 'first', vector: queryVector, metadata: '{}' },
      { id: 'b', text: 'last', vector: queryVector, metadata: '{}' },
    ]);
    await h.store.ensureCollection(); await h.store.ensureCollection();
    const all = await h.store.getAllEmbeddings();
    expect(all.ids.sort()).toEqual(['a', 'b']);
    expect(all.documents.sort()).toEqual(['last', 'new']);
    expect(logs.join(' ')).toMatch(/drop.*2|2.*duplicat/i);
  } finally { console.warn = warn; await h.close(); }
});
