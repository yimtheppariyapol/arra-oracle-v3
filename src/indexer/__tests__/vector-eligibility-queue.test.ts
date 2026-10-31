import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { safeEnqueueVectorJobs } from '../safe-vector-queue.ts';
import type { OracleDocument } from '../../types.ts';

test('the real enqueue boundary filters both documents and models after FTS storage', async () => {
  const db = new Database(':memory:');
  // Reuse existing Drizzle migrations, never alter a live schema.
  const migration = await Bun.file(new URL('../../db/migrations/0017_fts5_bootstrap.sql', import.meta.url)).text();
  db.exec(migration);
  const jobs = await Bun.file(new URL('../../db/migrations/0016_indexing_jobs.sql', import.meta.url)).text();
  db.exec(jobs);
  const documents = ['ψ/memory/learnings/a.md', 'ψ/inbox/results/a.md', 'ψ/learn/origin/a.ts'].map(
    (source_file, i): OracleDocument => ({ id: `doc-${i}`, type: 'learning', source_file,
      content: 'searchable source', concepts: [], created_at: 1, updated_at: 1 }));
  for (const doc of documents) db.query('INSERT INTO oracle_fts (id,content,concepts) VALUES (?,?,?)')
    .run(doc.id, doc.content, '[]');
  try {
    const models = { 'bge-m3': { collection: 'a' }, nomic: { collection: 'b' } };
    const stats = safeEnqueueVectorJobs(db, documents, new Set(documents.map((d) => d.id)), models);
    expect(stats).toEqual({ queued: 1, skipped: 0, failed: 0 });
    expect(db.query('SELECT doc_id,model_key FROM indexing_jobs').all())
      .toEqual([{ doc_id: 'doc-0', model_key: 'bge-m3' }]);
    expect(db.query("SELECT count(*) AS n FROM oracle_fts WHERE oracle_fts MATCH 'searchable'").get())
      .toEqual({ n: 3 });
    expect(safeEnqueueVectorJobs(db, documents, new Set(), models).queued).toBe(0);
  } finally { db.close(); }
});
