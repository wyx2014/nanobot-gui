import Database, { Database as BetterDatabase } from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

export interface MemoryDocument {
  docId: string;
  path: string;
  source: string;
  startLine: number;
  endLine: number;
  content: string;
  vector?: number[];
  timestamp?: number;
}

export interface HybridSearchResult {
  docId: string;
  path: string;
  source: string;
  startLine: number;
  endLine: number;
  content: string;
  timestamp: number;
  score: number;
}

export class MemoryStorage {
  private db: BetterDatabase;

  constructor(dbPath: string, vectorDimensions: number = 1536, forceDimension: boolean = false) {
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);
    this.initSchema(vectorDimensions, forceDimension);
  }

  private initSchema(dimensions: number, force: boolean) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id TEXT UNIQUE NOT NULL,
        path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        content,
        content='documents',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, content) VALUES('delete', old.id, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, content) VALUES('delete', old.id, old.content);
        INSERT INTO documents_fts(rowid, content) VALUES (new.id, new.content);
      END;
    `);

    // sqlite-vec requires recreating the virtual table if dimensions change.
    try {
      // Check current dimension if table exists
      const currentSchema = this.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vec_documents'").get() as { sql: string } | undefined;
      let existingDim = -1;
      if (currentSchema) {
        const match = currentSchema.sql.match(/float\[(\d+)\]/);
        if (match) existingDim = parseInt(match[1], 10);
      }

      if (existingDim !== dimensions) {
        if (force || existingDim === -1) {
          console.log(`[MemoryStorage] Vector dimension mismatch or table missing (existing: ${existingDim}, required: ${dimensions}). Initializing vec_documents...`);
          this.db.exec(`DROP TABLE IF EXISTS vec_documents;`);
          this.db.exec(`
            CREATE VIRTUAL TABLE vec_documents USING vec0(
              vector float[${dimensions}]
            );
          `);
        } else {
          console.log(`[MemoryStorage] Warning: Vector dimension mismatch (existing: ${existingDim}, requested: ${dimensions}). Keeping existing table to prevent data loss.`);
        }
      }
    } catch (e: any) {
      console.error('[MemoryStorage] Failed to initialize vec_documents:', e.message);
    }
  }

  public insertDocument(doc: MemoryDocument) {
    const ts = doc.timestamp || Date.now();

    const insertDoc = this.db.prepare(`
      INSERT INTO documents (doc_id, path, start_line, end_line, source, content, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(doc_id) DO UPDATE SET
        path = excluded.path,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        source = excluded.source,
        content = excluded.content,
        timestamp = excluded.timestamp
    `);

    const info = insertDoc.run(
      doc.docId,
      doc.path,
      doc.startLine,
      doc.endLine,
      doc.source,
      doc.content,
      ts
    );

    // rowid is info.lastInsertRowid. But for UPSERT, it might be 0 if updated.
    // We need the actual rowid.
    const rowIdStmt = this.db.prepare(`SELECT id FROM documents WHERE doc_id = ?`);
    const row = rowIdStmt.get(doc.docId) as { id: number };
    if (!row) return;

    if (doc.vector && doc.vector.length > 0) {
      const vectorFloat32 = new Float32Array(doc.vector);
      const insertVec = this.db.prepare(`
        INSERT INTO vec_documents (rowid, vector)
        VALUES (?, ?)
      `);

      // sqlite-vec doesn't support UPSERT on virtual tables easily. 
      // We must delete then insert.
      // rowid must be a BigInt for sqlite-vec to ensure 64-bit integer type
      const targetRowId = BigInt(row.id);
      this.db.prepare(`DELETE FROM vec_documents WHERE rowid = ?`).run(targetRowId);
      insertVec.run(targetRowId, vectorFloat32);
    }
  }

  public deleteDocument(docId: string) {
    const rowIdStmt = this.db.prepare(`SELECT id FROM documents WHERE doc_id = ?`);
    const row = rowIdStmt.get(docId) as { id: number };

    if (row) {
      this.db.prepare(`DELETE FROM vec_documents WHERE rowid = ?`).run(row.id);
      this.db.prepare(`DELETE FROM documents WHERE id = ?`).run(row.id);
    }
  }

  public searchVector(vector: number[], limit: number = 20): HybridSearchResult[] {
    const vectorFloat32 = new Float32Array(vector);

    const stmt = this.db.prepare(`
      SELECT 
        d.doc_id as docId,
        d.path,
        d.source,
        d.start_line as startLine,
        d.end_line as endLine,
        d.content,
        d.timestamp,
        (1.0 - vec_distance_cosine(v.vector, ?)) as score
      FROM vec_documents v
      JOIN documents d ON v.rowid = d.id
      WHERE v.vector MATCH ? AND k = ?
      ORDER BY score DESC
    `);

    // sqlite-vec uses knn search via `vector MATCH ? AND k = ?` but standard distance filtering also works.
    const rows = stmt.all(vectorFloat32, vectorFloat32, limit) as HybridSearchResult[];
    return rows;
  }

  public searchKeyword(query: string, limit: number = 20): HybridSearchResult[] {
    // Basic FTS5 match query
    // To make it robust against syntax errors, we strip special chars and use OR / AND
    const safeQuery = query.replace(/[^\p{L}\p{N}_\s]+/gu, ' ').trim().split(/\s+/).filter(Boolean).map(t => `"${t}"`).join(' AND ');

    if (!safeQuery) return [];

    const stmt = this.db.prepare(`
      SELECT 
        d.doc_id as docId,
        d.path,
        d.source,
        d.start_line as startLine,
        d.end_line as endLine,
        d.content,
        d.timestamp,
        bm25(documents_fts) as score
      FROM documents_fts f
      JOIN documents d ON f.rowid = d.id
      WHERE documents_fts MATCH ?
      ORDER BY score LIMIT ?
    `);

    const rows = stmt.all(safeQuery, limit) as any[];
    // BM25 usually ranks smaller negative scores as better in sqlite FTS5. We invert it for consistency (larger is better).
    // bm25(documents_fts) returns negative values, more negative means better match.
    return rows.map(r => ({ ...r, score: Math.abs(r.score) }));
  }

  public getDimensions(): number {
    try {
      const currentSchema = this.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vec_documents'").get() as { sql: string } | undefined;
      if (currentSchema) {
        const match = currentSchema.sql.match(/float\[(\d+)\]/);
        if (match) return parseInt(match[1], 10);
      }
    } catch (e: any) {
      console.error('[MemoryStorage] Failed to get dimensions:', e.message);
    }
    return 0;
  }

  public getTotalCount(): number {
    try {
      const row = this.db.prepare("SELECT count(*) as count FROM documents").get() as { count: number };
      return row.count;
    } catch (e: any) {
      console.error('[MemoryStorage] Failed to get total count:', e.message);
      return 0;
    }
  }

  public listDocuments(limit: number = 50): MemoryDocument[] {
    try {
      const rows = this.db.prepare(`
        SELECT doc_id as docId, path, start_line as startLine, end_line as endLine, source, content, timestamp
        FROM documents
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(limit) as MemoryDocument[];
      return rows;
    } catch (e: any) {
      console.error('[MemoryStorage] Failed to list documents:', e.message);
      return [];
    }
  }

  public close() {
    this.db.close();
  }
}
