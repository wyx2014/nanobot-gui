import { useState, useEffect, useMemo } from 'react';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useI18n } from '@/i18n';
import { skillTemplates } from '@/data/marketplace/skills';
import { skillLoader } from '@/core/skill/loader';
import MarketplaceCard from './MarketplaceCard';
import SubTabBar from './SubTabBar';
import SkillDetailModal from './SkillDetailModal';
import SkillEditor from './SkillEditor';
import { Toggle } from '@/components/ui/toggle';
import { Trash2, AlertCircle } from 'lucide-react';
import { fsBridge, osBridge } from '@/lib/ipc-factory';
import { joinPath, getParentDir } from '@/utils/pathUtils';
import type { Skill } from '@/types';
import type { MarketplaceItem } from '@/types/marketplace';

function getCategoryKey(category: string): string {
  const lower = category.toLowerCase();
  if (lower.includes('document') || lower.includes('文档')) return 'document';
  if (lower.includes('design') || lower.includes('设计')) return 'design';
  if (lower.includes('develop') || lower.includes('开发')) return 'development';
  return lower;
}

// Build a set of system skill names from marketplace templates
const systemSkillNames = new Set(
  skillTemplates.filter((t) => t.isBuiltin).map((t) => t.name)
);

// Check if a skill is a system (builtin) skill
function isSystemSkill(item: Skill | MarketplaceItem): boolean {
  if ('filePath' in item) {
    return item.filePath.includes('builtin-skills') || systemSkillNames.has(item.name);
  }
  return item.isBuiltin === true;
}

export default function SkillsSection({ manualCreateTrigger }: { manualCreateTrigger?: number }) {
  const { skills, refresh } = useDiscoveryStore();
  const { installingItem, setInstallingItem, toolboxSearchQuery, disabledSkills, toggleSkillEnabled } = useSettingsStore();
  const { t } = useI18n();

  const [installedSkills, setInstalledSkills] = useState<Skill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'system' | 'custom'>('system');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [detailItem, setDetailItem] = useState<
    | { kind: 'skill'; data: Skill }
    | { kind: 'template'; data: MarketplaceItem }
    | null
  >(null);
  const [editorSkill, setEditorSkill] = useState<Skill | 'new' | null>(null);

  // Open blank editor when manual create is triggered from parent
  useEffect(() => {
    if (manualCreateTrigger && manualCreateTrigger > 0) {
      setEditorSkill('new');
    }
  }, [manualCreateTrigger]);

  // Load full skill details for source info
  useEffect(() => {
    const loadSkillDetails = async () => {
      const fullSkills: Skill[] = [];
      for (const meta of skills) {
        const full = skillLoader.getSkill(meta.name);
        if (full) fullSkills.push(full);
      }
      setInstalledSkills(fullSkills);
    };
    loadSkillDetails();
  }, [skills]);

  const installedNames = useMemo(() => new Set(skills.map((s) => s.name)), [skills]);
  const disabledSet = useMemo(() => new Set(disabledSkills), [disabledSkills]);

  // Filter by search
  const searchLower = toolboxSearchQuery.toLowerCase();
  const matchesSearch = (name: string, description: string, tags?: string[]) => {
    if (!toolboxSearchQuery) return true;
    const tagStr = (tags ?? []).join(' ').toLowerCase();
    return name.toLowerCase().includes(searchLower) ||
      description.toLowerCase().includes(searchLower) ||
      tagStr.includes(searchLower);
  };

  // Separate system and custom skills from marketplace templates
  const systemTemplates = skillTemplates.filter((t) => {
    if (!isSystemSkill(t)) return false;
    if (!matchesSearch(t.name, t.description)) return false;
    if (categoryFilter !== 'all' && getCategoryKey(t.category) !== categoryFilter) return false;
    return true;
  });

  // Custom skills = installed skills that are NOT builtin
  const customInstalledSkills = installedSkills.filter(
    (s) => !isSystemSkill(s) && matchesSearch(s.name, s.description, s.tags)
  );

  // Install a skill from marketplace
  const handleInstall = async (template: (typeof skillTemplates)[0]) => {
    if (!template.content) return;

    setInstallingItem(template.id);
    setError(null);

    try {
      const home = await osBridge.homeDir();
      const skillDir = joinPath(home, '.ruyi/skills', template.name);
      await fsBridge.mkdir(skillDir, { recursive: true });
      await fsBridge.writeTextFile(joinPath(skillDir, 'SKILL.md'), template.content);
      await refresh();
    } catch (err) {
      console.error('[Skills] Failed to install:', err);
      setError(`${t.toolbox.installFailed}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInstallingItem(null);
    }
  };

  // Delete a user-installed skill
  const handleDelete = async (skill: Skill) => {
    if (skill.filePath.includes('builtin-skills')) return;

    try {
      const skillDir = getParentDir(skill.filePath);
      await fsBridge.remove(skillDir, { recursive: true });
      await refresh();
    } catch (err) {
      console.error('Failed to delete skill:', err);
    }
  };

  const handleCardClick = (template: MarketplaceItem) => {
    // Try to get full skill data if installed
    const installed = installedSkills.find((s) => s.name === template.name);
    if (installed) {
      setDetailItem({ kind: 'skill', data: installed });
    } else {
      setDetailItem({ kind: 'template', data: template });
    }
  };

  const handleCustomSkillClick = (skill: Skill) => {
    setDetailItem({ kind: 'skill', data: skill });
  };

  const handleEditSkill = (skill: Skill) => {
    setEditorSkill(skill);
    setDetailItem(null);
  };

  const handleEditorClose = () => {
    setEditorSkill(null);
  };

  const handleEditorSave = async () => {
    await refresh();
    setEditorSkill(null);
  };

  const getSourceLabel = (skill: Skill) => {
    if (skill.filePath.includes('builtin-skills') || systemSkillNames.has(skill.name))
      return { label: t.toolbox.sourceBuiltin, color: 'bg-blue-100 text-blue-600' };
    if (skill.filePath.includes('.ruyi/skills')) {
      if (skill.filePath.startsWith('.ruyi/'))
        return { label: t.toolbox.sourceProject, color: 'bg-purple-100 text-purple-600' };
      return { label: t.toolbox.sourceUser, color: 'bg-green-100 text-green-600' };
    }
    return { label: t.toolbox.sourceUnknown, color: 'bg-neutral-100 text-neutral-500' };
  };

  const subTabs = [
    { id: 'system', label: t.toolbox.tabSystem, count: systemTemplates.length },
    { id: 'custom', label: t.toolbox.tabCustom, count: customInstalledSkills.length },
  ];

  const categoryTabs = [
    { id: 'all', label: t.toolbox.categoryAll },
    { id: 'document', label: t.toolbox.categoryDocument },
    { id: 'design', label: t.toolbox.categoryDesign },
    { id: 'development', label: t.toolbox.categoryDevelopment },
  ];

  // If editor is open, show editor
  if (editorSkill !== null) {
    return (
      <SkillEditor
        skill={editorSkill === 'new' ? null : editorSkill}
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
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                categoryFilter === cat.id
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

        {/* System tab: marketplace template grid */}
        {activeSubTab === 'system' && (
          <>
            {systemTemplates.length === 0 ? (
              <div className="text-sm text-neutral-400 py-8 text-center">{t.toolbox.noSkillsFound}</div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {systemTemplates.map((template) => {
                  const isBuiltin = template.isBuiltin;
                  const isInstalled = isBuiltin || installedNames.has(template.name);
                  return (
                    <MarketplaceCard
                      key={template.id}
                      item={template}
                      isInstalled={isInstalled}
                      isInstalling={installingItem === template.id}
                      isEnabled={!disabledSet.has(template.name)}
                      onInstall={isInstalled ? undefined : () => handleInstall(template)}
                      onUninstall={
                        !isBuiltin && installedNames.has(template.name)
                          ? (() => {
                              const skill = installedSkills.find((s) => s.name === template.name);
                              if (skill && !skill.filePath.includes('builtin-skills')) {
                                handleDelete(skill);
                              }
                            })
                          : undefined
                      }
                      onToggleEnabled={
                        isInstalled
                          ? () => toggleSkillEnabled(template.name)
                          : undefined
                      }
                      onClick={() => handleCardClick(template)}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Custom tab: installed custom skills list */}
        {activeSubTab === 'custom' && (
          <>
            {customInstalledSkills.length === 0 ? (
              <div className="text-sm text-neutral-400 py-8 text-center">{t.toolbox.noCustomSkills}</div>
            ) : (
              <div className="space-y-2">
                {customInstalledSkills.map((skill) => {
                  const source = getSourceLabel(skill);
                  const isEnabled = !disabledSet.has(skill.name);
                  return (
                    <div
                      key={skill.name}
                      onClick={() => handleCustomSkillClick(skill)}
                      className={`group flex items-center gap-3 p-3 rounded-lg bg-white border border-neutral-200/60 cursor-pointer hover:border-neutral-300 ${
                        !isEnabled ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-neutral-900">/{skill.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${source.color}`}>
                            {source.label}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 mt-1 truncate">{skill.description}</p>
                      </div>
                      <Toggle checked={isEnabled} onChange={() => toggleSkillEnabled(skill.name)} />
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(skill); }}
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

      {/* Skill Detail Modal */}
      {detailItem && (
        <SkillDetailModal
          skill={detailItem.kind === 'skill' ? detailItem.data : null}
          template={detailItem.kind === 'template' ? detailItem.data : null}
          isInstalled={detailItem.kind === 'skill' || installedNames.has(detailItem.data.name)}
          onClose={() => setDetailItem(null)}
          onInstall={detailItem.kind === 'template' ? () => handleInstall(detailItem.data as MarketplaceItem) : undefined}
          onEdit={detailItem.kind === 'skill' ? () => handleEditSkill(detailItem.data as Skill) : undefined}
        />
      )}
    </div>
  );
}
