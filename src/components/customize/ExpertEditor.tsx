import { useState, useMemo } from 'react';
import { ArrowLeft, Save, Play } from 'lucide-react';
import { useI18n, format } from '@/i18n';
import { serializeExpertMd } from '@/core/expert/registry';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import type { ExpertDefinition, ExpertMetadata } from '@/types';
import { useSettingsStore, AVAILABLE_MODELS } from '@/stores/settingsStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useMCPStore } from '@/stores/mcpStore';
import { navigateToChatWithInput } from '@/utils/navigation';
import { useItemName } from '@/hooks/useItemName';
import { saveItemToAbuDir } from '@/utils/itemStorage';
import { cn } from '@/lib/utils';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';

interface ExpertEditorProps {
  expert: ExpertDefinition | null;  // null = creating new expert
  onClose: () => void;
  onSave: () => Promise<void>;
}

export default function ExpertEditor({ expert, onClose, onSave }: ExpertEditorProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const { agents } = useDiscoveryStore();
  const servers = useMCPStore((s) => s.servers);
  const mcpServers = useMemo(() => Object.values(servers), [servers]);

  const availableAgents = useMemo(() => agents.map(a => a.name), [agents]);
  const availableMCPs = useMemo(() => mcpServers.map(s => s.config.name), [mcpServers]);

  const { name, setName, nameValid, nameChanged } = useItemName(expert?.name ?? null);
  const [description, setDescription] = useState(expert?.description ?? '');
  const [model, setModel] = useState(() => {
    if (!expert?.model || expert.model === 'inherit') return '';
    const providerModels = AVAILABLE_MODELS[useSettingsStore.getState().provider] ?? [];
    if (providerModels.some((m) => m.id === expert.model)) return expert.model;
    return '';
  });

  const [selectedSubagents, setSelectedSubagents] = useState<Set<string>>(new Set(expert?.subagents ?? []));
  const [selectedMCPs, setSelectedMCPs] = useState<Set<string>>(new Set(expert?.mcpServers ?? []));

  const [instructions, setInstructions] = useState(expert?.instructions ?? '');

  // removed toggleSubagent and toggleMCP because MultiSelect handles Set replacement

  const buildMetadata = (): Partial<ExpertMetadata> => {
    return {
      name: name.trim(),
      description: description.trim(),
      model: model.trim() || 'inherit',
      mcpServers: selectedMCPs.size > 0 ? Array.from(selectedMCPs) : undefined,
      subagents: selectedSubagents.size > 0 ? Array.from(selectedSubagents) : undefined,
    };
  };

  const handleSave = async (): Promise<boolean> => {
    if (!name.trim()) return false;
    setSaving(true);
    try {
      const metadata = buildMetadata();
      const md = serializeExpertMd(metadata, instructions);
      const oldPath = (expert?.filePath && nameChanged) ? expert.filePath : undefined;
      await saveItemToAbuDir('experts', 'EXPERT.md', name.trim(), md, oldPath);
      await onSave();
      return true;
    } catch (err) {
      console.error('[ExpertEditor] Save failed:', err);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndTest = async () => {
    const ok = await handleSave();
    if (!ok) return;
    // Assuming we test experts similarly to agents
    navigateToChatWithInput(format(t.toolbox.agentTestPrompt, { name: name.trim() }));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-[#e8e4dd]/60">
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-[#656358] hover:text-[#29261b] hover:bg-[#f5f3ee] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-sm font-semibold text-[#29261b] flex-1">{t.toolbox.expertEditorTitle}</h2>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={!nameValid || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#29261b] text-[#faf9f5] hover:bg-[#3d3a2f] disabled:opacity-50 transition-colors"
          >
            <Save className="h-3.5 w-3.5" />
            {t.toolbox.expertSave}
          </button>
          <button
            onClick={handleSaveAndTest}
            disabled={!nameValid || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#d97757] text-white hover:bg-[#c5664a] disabled:opacity-50 transition-colors"
          >
            <Play className="h-3.5 w-3.5" />
            {t.toolbox.expertSaveAndTest}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-[#656358] uppercase tracking-wide">
            {t.toolbox.expertEditorMetadata}
          </h3>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-[#29261b]/70 mb-1">{t.toolbox.expertEditorName}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-expert"
                className={cn(
                  'w-full px-3 py-1.5 rounded-lg border text-sm text-[#29261b] bg-white focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757] transition-all',
                  name.trim() && !nameValid ? 'border-red-300' : 'border-[#e8e4dd]',
                )}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-[#29261b]/70 mb-1">{t.toolbox.expertModel}</label>
              <Select
                value={model}
                onChange={setModel}
                options={[
                  { value: '', label: t.toolbox.expertModelInherit },
                  ...(AVAILABLE_MODELS[useSettingsStore.getState().provider] ?? []).map((m) => ({
                    value: m.id,
                    label: m.label,
                  })),
                ]}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#29261b]/70 mb-1">{t.toolbox.expertEditorDescription}</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border border-[#e8e4dd] text-sm text-[#29261b] bg-white focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757] transition-all"
            />
          </div>

          {/* MCP Servers Selection */}
          <div>
            <label className="block text-xs font-medium text-[#29261b]/70 mb-1">{t.toolbox.expertEditorMCPServers}</label>
            <MultiSelect
              values={selectedMCPs}
              onChange={setSelectedMCPs}
              options={availableMCPs.map(srv => ({ value: srv, label: srv }))}
              placeholder={t.toolbox.expertEditorMCPServers}
            />
          </div>

          {/* Subagents Selection */}
          <div>
            <label className="block text-xs font-medium text-[#29261b]/70 mb-1">{t.toolbox.expertEditorSubagents}</label>
            <MultiSelect
              values={selectedSubagents}
              onChange={setSelectedSubagents}
              options={availableAgents.map(ag => ({ value: ag, label: ag }))}
              placeholder={t.toolbox.expertEditorSubagents}
            />
          </div>
        </div>

        {/* Content Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[#656358] uppercase tracking-wide">
              {t.toolbox.expertEditorInstructions}
            </h3>
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={`text-[11px] px-2 py-0.5 rounded-full transition-colors outline-none ${
                showPreview
                  ? 'bg-[#29261b] text-[#faf9f5]'
                  : 'bg-[#f5f3ee] text-[#656358] hover:bg-[#e8e4dd]'
              }`}
            >
              {t.toolbox.agentEditorPreview}
            </button>
          </div>

          {showPreview ? (
            <div className="border border-[#e8e4dd] rounded-lg p-4 bg-[#faf9f5] min-h-[200px] max-h-[400px] overflow-y-auto">
              <MarkdownRenderer content={instructions || '*No content yet*'} />
            </div>
          ) : (
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Write expert instructions in Markdown..."
              className="w-full min-h-[200px] max-h-[400px] px-3 py-2 rounded-lg border border-[#e8e4dd] text-sm text-[#29261b] bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757] transition-all resize-y"
            />
          )}
        </div>
      </div>
    </div>
  );
}
