import { useState, useMemo, useEffect } from 'react';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useI18n } from '@/i18n';
import { expertRegistry } from '@/core/expert/registry';
import ExpertDetailModal from './ExpertDetailModal';
import ExpertEditor from './ExpertEditor';
import { Toggle } from '@/components/ui/toggle';
import { Trash2 } from 'lucide-react';
import { fsBridge } from '@/lib/ipc-factory';
import { getParentDir } from '@/utils/pathUtils';
import type { ExpertDefinition } from '@/types';

export default function ExpertsSection({ manualCreateTrigger }: { manualCreateTrigger?: number }) {
  const { experts, refresh } = useDiscoveryStore();
  const { toolboxSearchQuery, disabledExperts, toggleExpertEnabled } = useSettingsStore();
  const { t } = useI18n();

  const [installedExperts, setInstalledExperts] = useState<ExpertDefinition[]>([]);
  const [detailItem, setDetailItem] = useState<ExpertDefinition | null>(null);
  const [editorExpert, setEditorExpert] = useState<ExpertDefinition | 'new' | null>(null);

  // Open blank editor when manual create is triggered from parent
  useEffect(() => {
    if (manualCreateTrigger && manualCreateTrigger > 0) {
      setEditorExpert('new');
    }
  }, [manualCreateTrigger]);

  // Load full expert details
  useEffect(() => {
    const loadExpertDetails = async () => {
      const fullExperts: ExpertDefinition[] = [];
      for (const meta of experts) {
        const full = expertRegistry.getExpert(meta.name);
        if (full) fullExperts.push(full);
      }
      setInstalledExperts(fullExperts);
    };
    loadExpertDetails();
  }, [experts]);

  const disabledSet = useMemo(() => new Set(disabledExperts), [disabledExperts]);

  // Filter experts by search
  const searchLower = toolboxSearchQuery.toLowerCase();
  const filteredExperts = installedExperts.filter((e) => {
    if (!toolboxSearchQuery) return true;
    return e.name.toLowerCase().includes(searchLower) || e.description.toLowerCase().includes(searchLower);
  });

  const handleDelete = async (expert: ExpertDefinition) => {
    try {
      const expertDir = getParentDir(expert.filePath);
      await fsBridge.remove(expertDir, { recursive: true });
      await refresh();
    } catch (err) {
      console.error('Failed to delete expert:', err);
    }
  };

  if (editorExpert !== null) {
    return (
      <ExpertEditor
        expert={editorExpert === 'new' ? null : editorExpert}
        onClose={() => setEditorExpert(null)}
        onSave={async () => {
          await refresh();
          setEditorExpert(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4">
        {filteredExperts.length === 0 ? (
          <div className="text-sm text-neutral-400 py-8 text-center">{t.toolbox.noInstalledExperts}</div>
        ) : (
          <div className="space-y-2">
            {filteredExperts.map((expert) => {
              const isEnabled = !disabledSet.has(expert.name);
              return (
                <div
                  key={expert.name}
                  onClick={() => setDetailItem(expert)}
                  className={`group flex items-center gap-3 p-3 rounded-lg bg-white border border-neutral-200/60 cursor-pointer hover:border-neutral-300 ${
                    !isEnabled ? 'opacity-60' : ''
                  }`}
                >
                  <div className="h-8 w-8 rounded-full bg-[#d97757]/10 text-[#d97757] flex items-center justify-center font-bold text-sm">
                    {expert.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-neutral-900">{expert.name}</span>
                    </div>
                    <p className="text-xs text-neutral-500 mt-0.5 truncate">{expert.description}</p>
                  </div>
                  <Toggle checked={isEnabled} onChange={() => toggleExpertEnabled(expert.name)} />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(expert); }}
                    className="shrink-0 p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {detailItem && (
        <ExpertDetailModal
          expert={detailItem}
          onClose={() => setDetailItem(null)}
          onEdit={() => {
            setEditorExpert(detailItem);
            setDetailItem(null);
          }}
        />
      )}
    </div>
  );
}
