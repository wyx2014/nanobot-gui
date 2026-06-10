import { useEffect } from 'react';
import { X, Cpu, Plug, Bot, Pencil } from 'lucide-react';
import { useI18n } from '@/i18n';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';
import type { ExpertDefinition } from '@/types';
import { useSettingsStore, resolveAgentModel, getEffectiveModel } from '@/stores/settingsStore';

interface ExpertDetailModalProps {
  expert: ExpertDefinition;
  onClose: () => void;
  onEdit?: () => void;
}

export default function ExpertDetailModal({ expert, onClose, onEdit }: ExpertDetailModalProps) {
  const { t } = useI18n();

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Resolve the actual model that will be used at runtime
  const settingsState = useSettingsStore();
  const resolvedModel = resolveAgentModel(expert.model, settingsState);
  const isInherit = !expert.model || expert.model === 'inherit';
  const globalModel = getEffectiveModel(settingsState);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-[#d97757]/10 text-[#d97757] flex items-center justify-center font-bold text-xs">
              {expert.name.charAt(0).toUpperCase()}
            </div>
            <h2 className="text-base font-semibold text-neutral-900">{expert.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Description */}
          <p className="text-sm text-neutral-600">{expert.description}</p>

          {/* Model */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
              <Cpu className="h-3.5 w-3.5" />
              {t.toolbox.expertModel}
            </div>
            <p className="text-xs text-neutral-600 pl-5 font-mono">
              {isInherit
                ? `${t.toolbox.expertModelInherit}（${globalModel}）`
                : resolvedModel !== expert.model
                  ? `${resolvedModel}（${t.toolbox.expertModelInherit}）`
                  : expert.model}
            </p>
          </div>

          {/* MCP Servers */}
          {expert.mcpServers && expert.mcpServers.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
                <Plug className="h-3.5 w-3.5" />
                {t.toolbox.expertEditorMCPServers}
              </div>
              <div className="flex flex-wrap gap-1 pl-5">
                {expert.mcpServers.map((srv) => (
                  <span key={srv} className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-mono">
                    {srv}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Subagents */}
          {expert.subagents && expert.subagents.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
                <Bot className="h-3.5 w-3.5" />
                {t.toolbox.expertEditorSubagents}
              </div>
              <div className="flex flex-wrap gap-1 pl-5">
                {expert.subagents.map((ag) => (
                  <span key={ag} className="px-2 py-0.5 rounded bg-purple-50 text-purple-600 text-[10px] font-mono">
                    {ag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Instructions */}
          {expert.instructions && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-neutral-500">{t.toolbox.expertEditorInstructions}</div>
              <div className="border border-neutral-200 rounded-lg p-3 bg-neutral-50 max-h-60 overflow-y-auto">
                <MarkdownRenderer content={expert.instructions} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-100">
          {onEdit && (
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-[#29261b] text-[#faf9f5] hover:bg-[#3d3a2f] transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t.toolbox.expertEdit}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
