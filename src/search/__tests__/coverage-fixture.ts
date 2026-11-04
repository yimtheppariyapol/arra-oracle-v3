import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../../db/create.ts';

export function coverageFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'entity-coverage-'));
  const dbPath = join(dir, 'oracle.db');
  const { sqlite } = createDatabase(dbPath);
  sqlite.run(`INSERT INTO oracle_documents
    (id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at)
    VALUES ('coverage-a', 'tenant-a', 'learning', 'coverage.md', '[]', 0, 0, 0)`);
  sqlite.run("INSERT INTO oracle_fts(id, content, concepts) VALUES ('coverage-a', 'coverage', '')");
  sqlite.run(`INSERT INTO oracle_entity_links
    (id, tenant_id, document_id, entity, entity_key, weight, created_at, updated_at)
    VALUES ('link-a', 'tenant-a', 'coverage-a', 'Coverage', 'coverage', 1, 0, 0)`);
  return { dbPath, sqlite, close() { sqlite.close(); rmSync(dir, { recursive: true }); } };
}

export async function until(check: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for coverage worker');
    await Bun.sleep(5);
  }
}
