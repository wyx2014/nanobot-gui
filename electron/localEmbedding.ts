import type { Llama, LlamaModel, LlamaEmbeddingContext } from 'node-llama-cpp';
import path from 'path';

export class LocalEmbeddingService {
  private static instance: LocalEmbeddingService;
  private llama: any | null = null;
  private model: any | null = null;
  private context: any | null = null;
  private initializing: Promise<void> | null = null;
  private currentModelPath: string | null = null;

  private constructor() {}

  static getInstance(): LocalEmbeddingService {
    if (!LocalEmbeddingService.instance) {
      LocalEmbeddingService.instance = new LocalEmbeddingService();
    }
    return LocalEmbeddingService.instance;
  }

  async init(modelPathOrUrl: string): Promise<void> {
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      try {
        console.log('[Main:LocalEmbedding] Initializing with model:', modelPathOrUrl);
        this.currentModelPath = modelPathOrUrl;
        
        if (!this.llama) {
          const { getLlama } = await import('node-llama-cpp');
          this.llama = await getLlama();
        }

        if (!this.model) {
           this.model = await this.llama.loadModel({ 
             modelPath: modelPathOrUrl,
           });
        }

        if (!this.context) {
          this.context = await this.model.createEmbeddingContext();
        }
        console.log('[Main:LocalEmbedding] Initialized successfully.');
      } catch (err) {
        this.initializing = null;
        console.error('[Main:LocalEmbedding] Failed to initialize:', err);
        throw err;
      }
    })();

    return this.initializing;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.context) {
      throw new Error('Local embedding service not initialized.');
    }
    const embedding = await this.context.getEmbeddingFor(text);
    return Array.from(embedding.vector);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.context) {
      throw new Error('Local embedding service not initialized.');
    }
    return Promise.all(texts.map(text => this.embed(text)));
  }

  getStatus(): 'running' | 'initializing' | 'stopped' {
    if (this.context) return 'running';
    if (this.initializing) return 'initializing';
    return 'stopped';
  }

  getModelPath(): string | null {
    return this.currentModelPath;
  }

  getDimensions(): number {
    if (!this.context) return 0;
    // node-llama-cpp embedding context usually has this info
    // but we can also just get it from a dummy embedding if needed.
    // However, for Gemma it's usually 768.
    return 768; // Default for our current model. 
  }
}

export const localEmbeddingService = LocalEmbeddingService.getInstance();
