import { memoryStorageClient, type MemoryDocument } from './storage/sqliteVecManager';
import { mergeHybridResults } from './hybrid';
import { type TemporalDecayConfig } from './temporal-decay';
import { type MMRConfig } from './mmr';
import { osBridge, ipc } from '@/lib/ipc-factory';
import { getLLMAdapter, getCurrentChatOptions } from '../llm';
import { useSettingsStore } from '@/stores/settingsStore';

export interface SearchOptions {
  limit?: number;
  temporalDecay?: Partial<TemporalDecayConfig>;
  mmr?: Partial<MMRConfig>;
  // For embedding if vector exists
  vector?: number[];
  workspaceDir?: string;
  sourceWeights?: { vector?: number; keyword?: number };
}

export interface AddMemoryOptions {
  path: string;
  source: string;
  startLine: number;
  endLine: number;
  content: string;
  vector?: number[];
}

export class MemoryManager {
  private async ensureStorage(): Promise<void> {
    const settings = useSettingsStore.getState();
    const dimensions = settings.embeddingDimensions;
    await memoryStorageClient.reinit(dimensions);
  }

  private async generateDocId(path: string, content: string): Promise<string> {
    const data = `${path}:${content}`;
    // Use native Web Crypto API for browser contexts
    const encoder = new TextEncoder();
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async getEmbedding(text: string): Promise<number[] | undefined> {
    const settings = useSettingsStore.getState();
    const provider = settings.embeddingProvider;

    try {
      if (provider === 'local') {
        const userData = await ipc.invoke<string>('os:appDataDir');
        const modelPath = `${userData}/models/embeddinggemma-300m-qat-Q4_0.gguf`;
        return await memoryStorageClient.getEmbedding(text, modelPath);
      } else {
        const adapter = getLLMAdapter();
        const options = {
          ...getCurrentChatOptions(),
          embeddingModel: settings.embeddingModel,
          embeddingApiKey: settings.embeddingApiKey,
          embeddingBaseUrl: settings.embeddingBaseUrl,
        };
        return await adapter.embed(text, options);
      }
    } catch (err) {
      console.warn(`Failed to generate embedding with provider ${provider}:`, err);
      return undefined;
    }
  }

  async addMemory(opts: AddMemoryOptions): Promise<void> {
    await this.ensureStorage();
    const vector = opts.vector || (await this.getEmbedding(opts.content));

    if (vector) {
      // Semantic De-duplication: check if a very similar memory already exists
      // We use a lower threshold (0.8) to detect "conflicting" facts (e.g. city change)
      const existing = await memoryStorageClient.searchVector(vector, 1);
      if (existing.length > 0 && existing[0].score > 0.8) {
        console.log(`[Memory] Found highly related memory (${existing[0].score.toFixed(3)}), replacing to avoid duplication/conflict: ${existing[0].docId}`);
        await this.deleteMemory(existing[0].docId);
      }
    }

    const docId = await this.generateDocId(opts.path, opts.content);
    const doc: MemoryDocument = {
      docId,
      path: opts.path,
      source: opts.source,
      startLine: opts.startLine,
      endLine: opts.endLine,
      content: opts.content,
      vector,
      timestamp: Date.now(),
    };
    await memoryStorageClient.insertDocument(doc);
  }

  async deleteMemory(docId: string): Promise<void> {
    await memoryStorageClient.deleteDocument(docId);
  }

  async search(query: string, options: SearchOptions = {}): Promise<any[]> {
    await this.ensureStorage();
    const limit = options.limit || 20;
    const searchVector = options.vector || (await this.getEmbedding(query));

    // 1. Dual Retrieval
    const keywordPromise = memoryStorageClient.searchKeyword(query, limit);
    const vectorPromise = searchVector
      ? memoryStorageClient.searchVector(searchVector, limit)
      : Promise.resolve([]);

    const [keywordResults, vectorResults] = await Promise.all([keywordPromise, vectorPromise]);

    // 2. Hybrid Merge
    let workspaceDir = options.workspaceDir;
    if (!workspaceDir) {
      workspaceDir = await osBridge.homeDir();
    }

    const merged = await mergeHybridResults({
      vector: vectorResults.map(v => ({
        id: v.docId,
        path: v.path,
        startLine: v.startLine,
        endLine: v.endLine,
        source: v.source,
        snippet: v.content,
        vectorScore: v.score,
      })),
      keyword: keywordResults.map(k => ({
        id: k.docId,
        path: k.path,
        startLine: k.startLine,
        endLine: k.endLine,
        source: k.source,
        snippet: k.content,
        textScore: k.score,
      })),
      vectorWeight: options.sourceWeights?.vector ?? 0.7,
      textWeight: options.sourceWeights?.keyword ?? 0.3,
      workspaceDir,
      temporalDecay: options.temporalDecay,
      mmr: options.mmr,
    });

    // Return final processed results
    return merged.map(item => ({
      docId: item.id,
      path: item.path,
      source: item.source,
      startLine: item.startLine,
      endLine: item.endLine,
      content: item.snippet,
      score: item.score,
    })).slice(0, limit);
  }
}

export const memoryManager = new MemoryManager();
