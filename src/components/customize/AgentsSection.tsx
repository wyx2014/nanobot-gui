import { useState, useEffect, useMemo } from 'react';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useI18n } from '@/i18n';
import { agentTemplates } from '@/data/marketplace/agents';
import { agentRegistry } from '@/core/agent/registry';
import MarketplaceCard from './MarketplaceCard';
import SubTabBar from './SubTabBar';
import AgentDetailModal from './AgentDetailModal';
import AgentEditor from './AgentEditor';
import { Toggle } from '@/components/ui/toggle';
import { Trash2, AlertCircle } from 'lucide-react';
import { fsBridge, osBridge } from '@/lib/ipc-factory';
import { joinPath, getParentDir } from '@/utils/pathUtils';
import type { SubagentDefinition } from '@/types';
import type { MarketplaceItem } from '@/types/marketplace';
import ruyiAvatar from '@/assets/ruyi-avatar.png';

function getAgentCategoryKey(category: string): string {
  const lower = category.toLowerCase();
  if (lower.includes('research') || lower.includes('研究')) return 'research';
  if (lower.includes('develop') || lower.includes('开发')) return 'development';
  if (lower.includes('writ') || lower.includes('写作')) return 'writing';
  return lower;
}

export default function AgentsSection({ manualCreateTrigger }: { manualCreateTrigger?: number }) {
  const { agents, refresh } = useDiscoveryStore();
  const { installingItem, setInstallingItem, toolboxSearchQuery, disabledAgents, toggleAgentEnabled } = useSettingsStore();
  const { t } = useI18n();

  const [installedAgents, setInstalledAgents] = useState<SubagentDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'system' | 'custom'>('system');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [detailItem, setDetailItem] = useState<
    | { kind: 'agent'; data: SubagentDefinition }
    | { kind: 'template'; data: MarketplaceItem }
    | null
  >(null);
  const [editorAgent, setEditorAgent] = useState<SubagentDefinition | 'new' | null>(null);

  // Open blank editor when manual create is triggered from parent
  useEffect(() => {
    if (manualCreateTrigger && manualCreateTrigger > 0) {
      setEditorAgent('new');
    }
  }, [manualCreateTrigger]);

  // Load full agent details for source info
  useEffect(() => {
    const loadAgentDetails = async () => {
      const fullAgents: SubagentDefinition[] = [];
      for (const meta of agents) {
        const full = agentRegistry.getAgent(meta.name);
        if (full) fullAgents.push(full);
      }
      setInstalledAgents(fullAgents);
    };
    loadAgentDetails();
  }, [agents]);

  const installedNames = useMemo(() => new Set(agents.map((a) => a.name)), [agents]);
  const disabledSet = useMemo(() => new Set(disabledAgents), [disabledAgents]);

  // Filter templates by search
  const searchLower = toolboxSearchQuery.toLowerCase();
  const matchesSearch = (name: string, description: string) => {
    if (!toolboxSearchQuery) return true;
    return name.toLowerCase().includes(searchLower) || description.toLowerCase().includes(searchLower);
  };

  const filteredTemplates = agentTemplates.filter((tmpl) => {
    if (!matchesSearch(tmpl.name, tmpl.description)) return false;
    if (categoryFilter !== 'all' && getAgentCategoryKey(tmpl.category) !== categoryFilter) return false;
    return true;
  });

  // Marketplace agent names — used to distinguish "installed from marketplace" vs "truly custom"
  const marketplaceNames = useMemo(() => new Set(agentTemplates.map((t) => t.name)), []);

  // Custom agents = installed agents that are NOT builtin, not ruyi, and not from marketplace
  const customInstalledAgents = installedAgents.filter((a) => {
    if (a.name === 'ruyi') return false;
    if (a.filePath === '__builtin__' || a.filePath.includes('builtin-agents')) return false;
    if (marketplaceNames.has(a.name)) return false;
    return matchesSearch(a.name, a.description);
  });

  // Install an agent from marketplace
  const handleInstall = async (template: MarketplaceItem) => {
    if (!template.content) return;

    setInstallingItem(template.id);
    setError(null);

    try {
      const home = await osBridge.homeDir();
      const agentDir = joinPath(home, '.ruyi/agents', template.name);

      await fsBridge.mkdir(agentDir, { recursive: true });
      await fsBridge.writeTextFile(joinPath(agentDir, 'AGENT.md'), template.content);
      await refresh();
    } catch (err) {
      console.error('Failed to install agent:', err);
      setError(`${t.toolbox.installFailed}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInstallingItem(null);
    }
  };

  // Delete a user-installed agent
  const handleDelete = async (agent: SubagentDefinition) => {
    if (agent.filePath === '__builtin__' || agent.filePath.includes('builtin-agents')) return;

    try {
      const agentDir = getParentDir(agent.filePath);
      await fsBridge.remove(agentDir, { recursive: true });
      await refresh();
    } catch (err) {
      console.error('Failed to delete agent:', err);
    }
  };

  const handleCardClick = (template: MarketplaceItem) => {
    const installed = installedAgents.find((a) => a.name === template.name);
    if (installed) {
      setDetailItem({ kind: 'agent', data: installed });
    } else {
      setDetailItem({ kind: 'template', data: template });
    }
  };

  const handleCustomAgentClick = (agent: SubagentDefinition) => {
    setDetailItem({ kind: 'agent', data: agent });
  };

  const handleEditAgent = (agent: SubagentDefinition) => {
    setEditorAgent(agent);
    setDetailItem(null);
  };

  const handleEditorClose = () => {
    setEditorAgent(null);
  };

  const handleEditorSave = async () => {
    await refresh();
    setEditorAgent(null);
  };

  const getSourceLabel = (agent: SubagentDefinition) => {
    const filePath = agent.filePath;
    if (filePath === '__builtin__' || filePath.includes('builtin-agents')) {
      return { label: t.toolbox.sourceBuiltin, color: 'bg-blue-100 text-blue-600' };
    }
    // Marketplace-installed agents: name matches a template
    if (marketplaceNames.has(agent.name)) {
      return { label: t.toolbox.sourceBuiltin, color: 'bg-blue-100 text-blue-600' };
    }
    if (filePath.includes('.ruyi/agents')) {
      if (filePath.startsWith('.ruyi/')) return { label: t.toolbox.sourceProject, color: 'bg-purple-100 text-purple-600' };
      return { label: t.toolbox.sourceUser, color: 'bg-green-100 text-green-600' };
    }
    return { label: t.toolbox.sourceUnknown, color: 'bg-neutral-100 text-neutral-500' };
  };

  const subTabs = [
    { id: 'system', label: t.toolbox.tabSystem, count: filteredTemplates.length + 1 },
    { id: 'custom', label: t.toolbox.tabCustom, count: customInstalledAgents.length },
  ];

  const categoryTabs = [
    { id: 'all', label: t.toolbox.agentCategoryAll },
    { id: 'research', label: t.toolbox.agentCategoryResearch },
    { id: 'development', label: t.toolbox.agentCategoryDevelopment },
    { id: 'writing', label: t.toolbox.agentCategoryWriting },
  ];

  // If editor is open, show editor
  if (editorAgent !== null) {
    return (
      <AgentEditor
        agent={editorAgent === 'new' ? null : editorAgent}
        onClose={handleEditorClose}
        onSave={handleEditorSave}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-tab bar */}
      <div className="shrink-0 px-4 pt-4 pb-2">
        <SubTabBar
          tabs={subTabs}
          activeTab={activeSubTab}
          onChange={(id) => setActiveSubTab(id as 'system' | 'custom')}
        />
      </div>

      {/* Category filter for system tab */}
      {activeSubTab === 'system' && (
        <div className="shrink-0 px-4 pb-2 flex gap-1.5 flex-wrap">
          {categoryTabs.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${categoryFilter === cat.id
                ? 'bg-[#29261b] text-[#faf9f5]'
                : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
                }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <div className="text-sm text-red-700">{error}</div>
          </div>
        )}

        {/* System tab: Ruyi main agent + marketplace templates */}
        {activeSubTab === 'system' && (
          <>
            {/* Ruyi Main Agent Card */}
            <div className="mb-4 p-3 rounded-lg bg-gradient-to-r from-[#d97757]/10 to-[#d97757]/5 border border-[#d97757]/20">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full overflow-hidden">
                  <img src={ruyiAvatar} alt="Ruyi" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-neutral-900">{t.common.appName}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-[#d97757]/20 text-[#d97757] rounded">
                      {t.toolbox.defaultAgent}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 mt-0.5">{t.toolbox.mainAgentDesc}</p>
                </div>
              </div>
            </div>

            {/* Marketplace Templates */}
            {filteredTemplates.length === 0 ? (
              <div className="text-sm text-neutral-400 py-4 text-center">{t.toolbox.noAgentsFound}</div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredTemplates.map((template) => (
                  <MarketplaceCard
                    key={template.id}
                    item={template}
                    isInstalled={installedNames.has(template.name)}
                    isInstalling={installingItem === template.id}
                    isEnabled={!disabledSet.has(template.name)}
                    onInstall={() => handleInstall(template)}
                    onUninstall={
                      installedNames.has(template.name)
                        ? (() => {
                          const agent = installedAgents.find((a) => a.name === template.name);
                          if (agent && agent.filePath !== '__builtin__' && !agent.filePath.includes('builtin-agents')) {
                            handleDelete(agent);
                          }
                        })
                        : undefined
                    }
                    onToggleEnabled={
                      installedNames.has(template.name)
                        ? () => toggleAgentEnabled(template.name)
                        : undefined
                    }
                    onClick={() => handleCardClick(template)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Custom tab: installed custom agents */}
        {activeSubTab === 'custom' && (
          <>
            {customInstalledAgents.length === 0 ? (
              <div className="text-sm text-neutral-400 py-8 text-center">{t.toolbox.noCustomAgents}</div>
            ) : (
              <div className="space-y-2">
                {customInstalledAgents.map((agent) => {
                  const source = getSourceLabel(agent);
                  const isEnabled = !disabledSet.has(agent.name);
                  return (
                    <div
                      key={agent.name}
                      onClick={() => handleCustomAgentClick(agent)}
                      className={`group flex items-center gap-3 p-3 rounded-lg bg-white border border-neutral-200/60 cursor-pointer hover:border-neutral-300 ${!isEnabled ? 'opacity-60' : ''
                        }`}
                    >
                      <div className="h-8 w-8 rounded-full bg-neutral-100 flex items-center justify-center">
                        <span className="text-base">{agent.avatar || '🤖'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-neutral-900">{agent.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${source.color}`}>
                            {source.label}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 mt-0.5 truncate">{agent.description}</p>
                      </div>
                      <Toggle checked={isEnabled} onChange={() => toggleAgentEnabled(agent.name)} />
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(agent); }}
                        className="shrink-0 p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Agent Detail Modal */}
      {detailItem && (
        <AgentDetailModal
          agent={detailItem.kind === 'agent' ? detailItem.data : null}
          template={detailItem.kind === 'template' ? detailItem.data : null}
          isInstalled={detailItem.kind === 'agent' || installedNames.has(detailItem.data.name)}
          onClose={() => setDetailItem(null)}
          onInstall={detailItem.kind === 'template' ? () => handleInstall(detailItem.data as MarketplaceItem) : undefined}
          onEdit={
            detailItem.kind === 'agent' &&
              detailItem.data.filePath !== '__builtin__' &&
              !detailItem.data.filePath.includes('builtin-agents')
              ? () => handleEditAgent(detailItem.data as SubagentDefinition)
              : undefined
          }
        />
      )}
    </div>
  );
}
