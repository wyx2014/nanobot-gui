import { ipc } from '@/lib/ipc-factory';

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

export class SqliteVecManager {
  async insertDocument(doc: MemoryDocument): Promise<void> {
    await ipc.invoke('memory:insert', doc);
  }

  async deleteDocument(docId: string): Promise<void> {
    await ipc.invoke('memory:delete', { docId });
  }

  async searchVector(vector: number[], limit: number = 20): Promise<HybridSearchResult[]> {
    return await ipc.invoke<HybridSearchResult[]>('memory:searchVector', { vector, limit });
  }

  async searchKeyword(query: string, limit: number = 20): Promise<HybridSearchResult[]> {
    return await ipc.invoke<HybridSearchResult[]>('memory:searchKeyword', { query, limit });
  }

  async reinit(dimensions: number): Promise<void> {
    await ipc.invoke('memory:reinit', { dimensions });
  }

  async getEmbedding(text: string, modelPath?: string): Promise<number[]> {
    return await ipc.invoke<number[]>('memory:getEmbedding', { text, modelPath });
  }
}

export const memoryStorageClient = new SqliteVecManager();
