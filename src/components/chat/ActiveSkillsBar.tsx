import { useMemo } from 'react';
import { Wand2, X } from 'lucide-react';
import { useChatStore, useActiveConversation } from '@/stores/chatStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useI18n } from '@/i18n';
import { projectUsableSkills } from '@/core/skills/filter';
import { normalizeProjectPath, visibleProjectPath } from '@/core/workspace';
import type { Conversation } from '@/types';

export default function ActiveSkillsBar() {
  const activeConv = useActiveConversation();
  const { t } = useI18n();
  const skills = useDiscoveryStore((s) => s.skills);
  const projectSkillBindings = useWorkspaceStore((s) => s.projectSkillBindings);
  const projectPath = visibleProjectPath(activeConv?.workspaceScope?.project_path ?? activeConv?.workspacePath);
  const projectSkillNames = projectPath ? projectSkillBindings[normalizeProjectPath(projectPath)] ?? [] : [];
  const availableSkills = useMemo(
    () => new Set(projectUsableSkills(skills, projectSkillNames).map((skill) => skill.name)),
    [projectSkillNames, skills],
  );
  const activeSkills = activeConv?.activeSkills?.filter((name) => availableSkills.has(name));

  if (!activeSkills || activeSkills.length === 0) return null;

  const handleRemove = (skillName: string) => {
    const activeId = useChatStore.getState().activeConversationId;
    if (!activeId) return;

    useChatStore.setState((draft: { conversations: Record<string, Conversation> }) => {
      const conv = draft.conversations[activeId];
      if (conv?.activeSkills) {
        conv.activeSkills = conv.activeSkills.filter((n: string) => n !== skillName);
      }
    });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-[#656358] font-medium">{t.toolbox.activeSkills}</span>
      {activeSkills.map((name) => (
        <span
          key={name}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[11px] font-medium"
        >
          <Wand2 className="h-3 w-3" />
          {name}
          <button
            onClick={() => handleRemove(name)}
            className="ml-0.5 p-0.5 rounded-full hover:bg-purple-200 transition-colors"
            title={t.toolbox.activeSkillsRemove}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
    </div>
  );
}
