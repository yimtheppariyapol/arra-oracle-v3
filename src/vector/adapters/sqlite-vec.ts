import { Database } from 'bun:sqlite';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../../db/schema.ts';
import { assertSqliteIdentifier, sqliteVecEmbeddingsTable, sqliteVecMetadataTable } from '../../db/schema.ts';
import { validateVector } from '../embedding-cache.ts';
import { documentVectors } from '../document-vectors.ts';
import type { EmbeddingProvider, VectorDocument, VectorQueryResult, VectorStoreAdapter } from '../types.ts';

type SqliteVecDb = BunSQLiteDatabase<typeof schema>;
type SqliteVecRow = { id: string; distance: number | null; document: string; metadata: string };
type SqliteVecEmbeddingRow = { id: string; embedding: Buffer; metadata: string };

function toBlob(vec: number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer);
}

function fromBlob(blob: unknown): number[] {
  if (blob instanceof Buffer || blob instanceof Uint8Array) {
    return Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));
  }
  if (typeof blob === 'string') {
    try { return JSON.parse(blob) as number[]; } catch { return []; }
  }
  return [];
}

function rowsToResult(rows: SqliteVecRow[]): VectorQueryResult {
  return {
    ids: rows.map((row) => row.id),
    documents: rows.map((row) => row.document),
    distances: rows.map((row) => row.distance ?? 0),
    metadatas: rows.map((row) => JSON.parse(row.metadata)),
  };
}

export class SqliteVecAdapter implements VectorStoreAdapter {
  readonly name = 'sqlite-vec';
  private sqlite: Database | null = null;
  private db: SqliteVecDb | null = null;

  constructor(
    private collectionName: string,
    private dbPath: string,
    private embedder: EmbeddingProvider,
  ) {}

  async connect(): Promise<void> {
    if (this.db) return;

    const sqlite = new Database(this.dbPath);
    this.sqlite = sqlite;
    this.db = drizzle(sqlite, { schema });
    let loaded = false;
    const tryPaths = ['vec0', '/usr/local/lib/sqlite-vec'];

    try {
      const sqliteVec = require('sqlite-vec');
      sqlite.loadExtension(sqliteVec.getLoadablePath());
      loaded = true;
    } catch {
      for (const p of tryPaths) {
        try { sqlite.loadExtension(p); loaded = true; break; }
        catch { /* try next */ }
      }
    }

    if (!loaded) throw new Error('Failed to load sqlite-vec extension. Install: bun add sqlite-vec');
    console.log('[sqlite-vec] Connected');
  }

  async close(): Promise<void> {
    if (!this.sqlite) return;
    this.sqlite.close();
    this.sqlite = null;
    this.db = null;
    console.log('[sqlite-vec] Closed');
  }

  async ensureCollection(): Promise<void> {
    const db = this.requireDb();
    const name = assertSqliteIdentifier(this.collectionName, 'sqlite-vec collection');
    const dims = Math.trunc(this.embedder.dimensions);
    if (!Number.isFinite(dims) || dims <= 0) throw new Error(`Invalid sqlite-vec dimensions: ${this.embedder.dimensions}`);

    db.run(sql.raw(`CREATE TABLE IF NOT EXISTS "${name}_meta" (id TEXT PRIMARY KEY, document TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}')`));
    db.run(sql.raw(`CREATE VIRTUAL TABLE IF NOT EXISTS "${name}_vec" USING vec0(id TEXT PRIMARY KEY, embedding float[${dims}])`));

    console.log(`[sqlite-vec] Collection '${this.collectionName}' ready (${dims} dims)`);
  }

  async deleteCollection(): Promise<void> {
    const db = this.requireDb();
    const name = assertSqliteIdentifier(this.collectionName, 'sqlite-vec collection');
    try {
      db.run(sql.raw(`DROP TABLE IF EXISTS "${name}_meta"`));
      db.run(sql.raw(`DROP TABLE IF EXISTS "${name}_vec"`));
      console.log(`[sqlite-vec] Collection '${this.collectionName}' deleted`);
    } catch (e) {
      console.warn('[sqlite-vec] deleteCollection failed:', e instanceof Error ? e.message : String(e));
    }
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    if (!docs.length) return;
    const vectors = await documentVectors(docs, this.embedder);
    await this.upsertVectors(docs.map((doc, i) => ({ ...doc, vector: vectors[i] })));
  }

  async upsertVectors(docs: Array<VectorDocument & { vector: number[] }>): Promise<void> {
    if (!docs.length) return;
    docs.forEach((doc) => validateVector(doc.vector, this.embedder.dimensions));
    const db = this.requireDb();
    await this.ensureCollection();
    const { meta, vec } = this.tables();

    db.transaction((tx) => {
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        tx.delete(meta).where(eq(meta.id, doc.id)).run();
        tx.delete(vec).where(eq(vec.id, doc.id)).run();
        tx.insert(meta).values({ id: doc.id, document: doc.document, metadata: JSON.stringify(doc.metadata) }).run();
        tx.insert(vec).values({ id: doc.id, embedding: toBlob(doc.vector) }).run();
      }
    });

    console.log(`[sqlite-vec] Added ${docs.length} documents`);
  }

  async query(text: string, limit = 10, where?: Record<string, unknown>): Promise<VectorQueryResult> {
    this.requireDb();
    const [queryEmbedding] = await this.embedder.embed([text], 'query');
    return this.queryByVector(queryEmbedding, limit, where);
  }

  async queryById(id: string, nResults = 5): Promise<VectorQueryResult> {
    const db = this.requireDb();
    const { vec } = this.tables();
    const doc = db.select({ embedding: vec.embedding }).from(vec).where(eq(vec.id, id)).get();
    if (!doc) throw new Error(`No embedding found for document: ${id}`);
    return rowsToResult(this.nearestRows(db, doc.embedding, nResults + 1).filter((row) => row.id !== id).slice(0, nResults));
  }

  async queryByVector(vector: number[], nResults = 5, where?: Record<string, unknown>): Promise<VectorQueryResult> {
    const db = this.requireDb();
    return rowsToResult(this.nearestRows(db, toBlob(vector), nResults, where));
  }

  async deleteDocuments(ids: string[]): Promise<void> {
    const db = this.requireDb();
    const { meta, vec } = this.tables();
    db.transaction((tx) => {
      for (const id of ids) {
        tx.delete(meta).where(eq(meta.id, id)).run();
        tx.delete(vec).where(eq(vec.id, id)).run();
      }
    });
  }

  async listDocumentIds(): Promise<string[]> {
    const { meta: table } = this.tables();
    return this.requireDb().select({ id: table.id }).from(table).all().map((row) => row.id);
  }

  async getStats(): Promise<{ count: number }> {
    if (!this.db) return { count: 0 };
    try {
      const { meta } = this.tables();
      const row = this.db.select({ count: count() }).from(meta).get();
      return { count: Number(row?.count ?? 0) };
    } catch {
      return { count: 0 };
    }
  }

  async getCollectionInfo(): Promise<{ count: number; name: string }> {
    return { count: (await this.getStats()).count, name: this.collectionName };
  }

  async getAllEmbeddings(limit = 5000): Promise<{ ids: string[]; embeddings: number[][]; metadatas: unknown[] }> {
    if (!this.db) return { ids: [], embeddings: [], metadatas: [] };
    const { meta, vec } = this.tables();
    const rows = this.db.select({ id: vec.id, embedding: vec.embedding, metadata: meta.metadata })
      .from(vec)
      .innerJoin(meta, eq(vec.id, meta.id))
      .limit(limit)
      .all() as SqliteVecEmbeddingRow[];

    return {
      ids: rows.map((row) => row.id),
      embeddings: rows.map((row) => fromBlob(row.embedding)),
      metadatas: rows.map((row) => JSON.parse(row.metadata)),
    };
  }

  private nearestRows(db: SqliteVecDb, embedding: Buffer, limit: number, where?: Record<string, unknown>): SqliteVecRow[] {
    const { meta, vec } = this.tables();
    const predicates = Object.entries(where ?? {}).map(([key, value]) =>
      sql`json_extract(${meta.metadata}, ${`$.${JSON.stringify(key)}`}) = ${value}`);
    const eligible = predicates.length ? db.select({ id: meta.id }).from(meta).where(and(...predicates)) : null;
    return db.select({ id: vec.id, distance: vec.distance, document: meta.document, metadata: meta.metadata })
      .from(vec)
      .innerJoin(meta, eq(vec.id, meta.id))
      .where(and(sql`${vec.embedding} MATCH ${embedding}`, eq(vec.k, limit),
        eligible ? inArray(vec.id, eligible) : undefined))
      .orderBy(vec.distance)
      .all() as SqliteVecRow[];
  }

  private requireDb(): SqliteVecDb {
    if (!this.db) throw new Error('sqlite-vec not connected');
    return this.db;
  }

  private tables() {
    return {
      meta: sqliteVecMetadataTable(this.collectionName),
      vec: sqliteVecEmbeddingsTable(this.collectionName),
    };
  }
}
