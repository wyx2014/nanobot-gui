import { Brain, Trash2, Database as DbIcon, RefreshCw, Circle } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { useState, useEffect, useCallback } from 'react';
import { ipc } from '@/lib/ipc-factory';

interface MemoryStatus {
  status: 'running' | 'initializing' | 'stopped';
  dimensions: number;
  totalCount: number;
  modelPath: string | null;
}

interface MemoryDocument {
  docId: string;
  path: string;
  startLine: number;
  endLine: number;
  source: string;
  content: string;
  timestamp: number;
}

export default function MemorySection() {
  const store = useSettingsStore();
  const { t } = useI18n();

  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [documents, setDocuments] = useState<MemoryDocument[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const result = await ipc.invoke<MemoryStatus>('memory:getStatus');
      setStatus(result);
      
      // Auto-update dimensions in store if using local and and status is running
      if (store.embeddingProvider === 'local' && result.status === 'running' && result.dimensions > 0) {
        if (store.embeddingDimensions !== result.dimensions) {
          store.setEmbeddingDimensions(result.dimensions);
        }
      }

      // Proactively initialize if local is selected but stopped
      if (store.embeddingProvider === 'local' && result.status === 'stopped') {
        console.log('Proactively initializing local engine...');
        await ipc.invoke('memory:reinit', { dimensions: 768 });
      }
    } catch (err) {
      console.error('Failed to fetch memory status:', err);
    }
  }, [ipc, store.embeddingProvider, store.embeddingDimensions, store.setEmbeddingDimensions]);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const docs = await ipc.invoke<MemoryDocument[]>('memory:list', { limit: 10 });
      setDocuments(docs);
    } catch (err) {
      console.error('Failed to fetch memory documents:', err);
    } finally {
      setLoading(false);
    }
  }, [ipc]);

  const handleDelete = async (docId: string) => {
    if (!confirm(t.settings.embedding.deleteConfirm)) return;
    try {
      await ipc.invoke('memory:delete', { docId });
      fetchDocuments();
      fetchStatus();
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchDocuments();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchDocuments]);

  return (
    <div className="space-y-6">
      {/* Introduction & Status */}
      <div className="p-4 bg-[#f5f3ee] rounded-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-[#d97757]" />
            <h3 className="text-sm font-semibold text-[#29261b]">{t.settings.embedding.title}</h3>
          </div>
          {store.embeddingProvider === 'local' ? (
            status && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/50 border border-[#e8e4dd]">
                <Circle className={cn(
                  "h-2 w-2 fill-current",
                  status.status === 'running' ? "text-green-500" : 
                  status.status === 'initializing' ? "text-amber-500 animate-pulse" : "text-red-400"
                )} />
                <span className="text-[10px] font-medium text-[#656358] uppercase tracking-wider">
                  {t.settings.embedding.localStatus}: {
                    status.status === 'running' ? t.settings.embedding.running : 
                    status.status === 'initializing' ? t.settings.embedding.initializing : t.settings.embedding.stopped
                  }
                </span>
              </div>
            )
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-50 border border-blue-100">
              <Circle className="h-2 w-2 fill-current text-blue-500" />
              <span className="text-[10px] font-medium text-blue-700 uppercase tracking-wider">
                {t.settings.embedding.remoteAPI}
              </span>
            </div>
          )}
        </div>
        <p className="text-xs text-[#888579] leading-relaxed">
          {t.settings.embedding.setupDesc}
        </p>
        
        {status && status.status === 'running' && (
           <div className="flex gap-4 pt-1 border-t border-[#e8e4dd]/50 mt-2">
             <div>
               <p className="text-[10px] text-[#888579] uppercase">{t.settings.embedding.dimensions}</p>
               <p className="text-xs font-semibold text-[#29261b]">{status.dimensions}</p>
             </div>
             <div>
               <p className="text-[10px] text-[#888579] uppercase">{t.settings.embedding.totalRecords}</p>
               <p className="text-xs font-semibold text-[#29261b]">{status.totalCount}</p>
             </div>
           </div>
        )}
      </div>

      <div className="space-y-5">
        {/* Embedding Provider */}
        <div className="space-y-2">
          <label className="text-xs text-[#656358] font-medium">{t.settings.embedding.provider}</label>
          <div className="flex gap-2">
            {[
              { id: 'local', label: t.settings.embedding.localMode },
              { id: 'openai', label: 'OpenAI (Remote)' },
              { id: 'openai-compatible', label: 'Custom (OpenAI Compatible)' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => store.setEmbeddingProvider(p.id as any)}
                className={cn(
                  'flex-1 h-9 px-3 rounded-lg text-sm font-medium transition-all',
                  store.embeddingProvider === p.id
                    ? 'bg-[#d97757] text-white'
                    : 'bg-[#f5f3ee] text-[#656358] hover:bg-[#e8e5de]'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Remote Configuration */}
        {store.embeddingProvider !== 'local' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200 pt-2 border-t border-[#e8e4dd]">
            {/* Remote Model Name */}
            <div className="space-y-2">
              <label className="text-xs text-[#656358] font-medium">{t.settings.embedding.model}</label>
              <Input
                value={store.embeddingModel}
                onChange={(e) => store.setEmbeddingModel(e.target.value)}
                placeholder={store.embeddingProvider === 'openai' ? "text-embedding-3-small" : "model name"}
              />
            </div>

            {/* Remote API Key */}
            <div className="space-y-2">
              <label className="text-xs text-[#656358] font-medium">{t.settings.embedding.apiKey}</label>
              <Input
                type="password"
                value={store.embeddingApiKey}
                onChange={(e) => store.setEmbeddingApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </div>

            {/* Remote Base URL */}
            <div className="space-y-2">
              <label className="text-xs text-[#656358] font-medium">{t.settings.embedding.baseUrl}</label>
              <Input
                value={store.embeddingBaseUrl}
                onChange={(e) => store.setEmbeddingBaseUrl(e.target.value)}
                placeholder={store.embeddingProvider === 'openai' ? "https://api.openai.com/v1" : "https://api.your-provider.com/v1"}
              />
            </div>
            
            {/* Vector Dimensions (Selectable for remote) */}
            <div className="space-y-2">
              <label className="text-xs text-[#656358] font-medium">{t.settings.embedding.dimensions}</label>
              <div className="flex gap-2">
                {[768, 1024, 1536, 3072].map((dim) => (
                  <button
                    key={dim}
                    onClick={() => store.setEmbeddingDimensions(dim)}
                    className={cn(
                      'flex-1 h-9 px-3 rounded-lg text-sm font-medium transition-all',
                      store.embeddingDimensions === dim
                        ? 'bg-[#29261b] text-white'
                        : 'bg-[#f5f3ee] text-[#656358] hover:bg-[#e8e5de]'
                    )}
                  >
                    {dim}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Stored Memory List */}
        <div className="pt-6 border-t border-[#e8e4dd] space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DbIcon className="h-4 w-4 text-[#888579]" />
              <h3 className="text-sm font-semibold text-[#29261b]">{t.settings.embedding.database}</h3>
            </div>
            <button 
              onClick={fetchDocuments}
              className="p-1.5 text-[#888579] hover:text-[#d97757] transition-colors"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
          </div>

          <div className="rounded-xl border border-[#e8e4dd] overflow-hidden bg-white max-h-[300px] overflow-y-auto">
            {documents.length > 0 ? (
              <div className="divide-y divide-[#e8e4dd]">
                {documents.map((doc) => (
                  <div key={doc.docId} className="p-3 hover:bg-[#faf9f7] group transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono bg-[#f5f3ee] text-[#888579] px-1.5 py-0.5 rounded">
                            {doc.source}
                          </span>
                          <span className="text-[10px] text-[#b4b1a6] truncate italic">
                            {doc.path}
                          </span>
                        </div>
                        <p className="text-xs text-[#29261b] line-clamp-2 leading-relaxed">
                          {doc.content}
                        </p>
                        <p className="text-[10px] text-[#b4b1a6]">
                          {new Date(doc.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <button 
                        onClick={() => handleDelete(doc.docId)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-[#888579] hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 flex flex-col items-center justify-center text-[#b4b1a6] space-y-2">
                <DbIcon className="h-8 w-8 opacity-20" />
                <p className="text-xs">{t.settings.embedding.noRecords}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
