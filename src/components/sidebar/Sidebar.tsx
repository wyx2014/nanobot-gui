import { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { usePromptHubStore } from '@/stores/promptHubStore';
import { useI18n } from '@/i18n';
import { Plus, Clock, Wrench, Trash2, Settings, Download, Pencil, Undo2, HelpCircle, ChevronRight, MoreHorizontal, SquarePen, FolderOpen, FolderClosed, X, Search, LogOut, UserRound } from 'lucide-react';
import GuideModal from '@/components/common/GuideModal';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ConversationStatus } from '@/types';
import { dialogBridge, fsBridge, shellBridge } from '@/lib/ipc-factory';
import { isMacOS } from '@/utils/platform';
import { normalizeProjectPath, projectNameFromPath, visibleProjectPath } from '@/core/workspace';
import type { Conversation } from '@/types';
import { fetchProjectSkills, saveProjectSkills as saveProjectSkillsApi } from '@/core/api';
import { getNanobotStatus, getNanobotToken, refreshNanobotAuth } from '@/core/nanobotClient';

interface StatusIndicatorProps {
  status: ConversationStatus;
  onComplete: () => void;
}

function StatusIndicator({ status, onComplete }: StatusIndicatorProps) {
  useEffect(() => {
    if (status === 'completed') {
      const timer = setTimeout(onComplete, 3000);
      return () => clearTimeout(timer);
    }
  }, [status, onComplete]);

  if (status === 'running') {
    return <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />;
  }
  if (status === 'completed') {
    return <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />;
  }
  if (status === 'error') {
    return <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />;
  }
  return null;
}

const PROJECT_VISIBLE_LIMIT = 5;
const PROJECT_MENU_WIDTH = 150;
const PROJECT_MENU_HEIGHT = 140;

async function getProjectSkillsAuth(): Promise<{ token: string; baseUrl: string }> {
  const status = await getNanobotStatus();
  if (!status.ready) throw new Error('nanobot 服务尚未就绪');
  const baseUrl = `http://127.0.0.1:${status.port}`;
  const token = getNanobotToken();
  if (token) return { token, baseUrl };
  const refreshed = await refreshNanobotAuth();
  return { token: refreshed.token, baseUrl: refreshed.baseUrl };
}

function projectPathForConversation(conv: Conversation): string | null {
  return visibleProjectPath(conv.workspaceScope?.project_path ?? conv.workspacePath ?? null);
}

function projectNameForConversation(conv: Conversation, path: string): string {
  return conv.workspaceScope?.project_name ?? projectNameFromPath(path);
}

export default function Sidebar() {
  const { conversations, activeConversationId, startNewConversation, switchConversation, deleteConversation, renameConversation, clearCompletedStatus, exportConversation, importConversation } = useChatStore();
  const openToolbox = useSettingsStore((s) => s.openToolbox);
  const openSystemSettings = useSettingsStore((s) => s.openSystemSettings);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const updateInfo = useSettingsStore((s) => s.updateInfo);
  const unviewedRunCount = useScheduleStore((s) => s.getUnviewedRunCount());
  const scheduledTasks = useScheduleStore((s) => s.tasks);
  const recentWorkspacePaths = useWorkspaceStore((s) => s.recentPaths);
  const projectNames = useWorkspaceStore((s) => s.projectNames);
  const projectSkillBindings = useWorkspaceStore((s) => s.projectSkillBindings);
  const removeRecentPath = useWorkspaceStore((s) => s.removeRecentPath);
  const setProjectSkillBindings = useWorkspaceStore((s) => s.setProjectSkillBindings);
  const skills = useDiscoveryStore((s) => s.skills);
  const promptHubUser = usePromptHubStore((s) => s.user);
  const promptHubIsLoggingIn = usePromptHubStore((s) => s.isLoggingIn);
  const promptHubOpen = usePromptHubStore((s) => s.loginOpen);
  const promptHubError = usePromptHubStore((s) => s.error);
  const loginPromptHub = usePromptHubStore((s) => s.login);
  const logoutPromptHub = usePromptHubStore((s) => s.logout);
  const openPromptHubLogin = usePromptHubStore((s) => s.openLogin);
  const closePromptHubLogin = usePromptHubStore((s) => s.closeLogin);
  const { t } = useI18n();

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; convId: string } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [pendingRemoveProject, setPendingRemoveProject] = useState<{ path: string; name: string } | null>(null);
  const [skillProject, setSkillProject] = useState<{ path: string; name: string } | null>(null);
  const [skillSearch, setSkillSearch] = useState('');
  const [draftSkillBindings, setDraftSkillBindings] = useState<string[]>([]);
  const [promptHubUsername, setPromptHubUsername] = useState('');
  const [promptHubPassword, setPromptHubPassword] = useState('');
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Undo delete state
  const [pendingDelete, setPendingDelete] = useState<{ id: string; data: string } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Inline rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set());

  // Guide modal state — auto-open on first launch only
  const setGuideShown = useSettingsStore((s) => s.setGuideShown);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideCheckedRef = useRef(false);

  useEffect(() => {
    if (guideCheckedRef.current) return;
    // Wait for persist rehydration — guideShown stays false (default) until rehydrated
    const unsub = useSettingsStore.persist.onFinishHydration(() => {
      guideCheckedRef.current = true;
      if (!useSettingsStore.getState().guideShown) {
        setGuideOpen(true);
      }
    });
    // If already hydrated (e.g. hot reload), check immediately
    if (useSettingsStore.persist.hasHydrated()) {
      guideCheckedRef.current = true;
      if (!useSettingsStore.getState().guideShown) {
        setGuideOpen(true);
      }
    }
    return unsub;
  }, []);


  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenu && !projectMenu) return;
    const handleClick = () => {
      setContextMenu(null);
      setProjectMenu(null);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [contextMenu, projectMenu]);

  // Sort by createdAt to keep positions stable during status updates
  // Filter out conversations created by scheduled tasks — they appear in ScheduledSection
  const scheduledConversationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of Object.values(scheduledTasks)) {
      for (const run of task.runs) {
        const sessionKey = run.sessionKey ?? run.conversationId;
        if (sessionKey) ids.add(sessionKey);
      }
    }
    return ids;
  }, [scheduledTasks]);

  const sortedConvs = Object.values(conversations)
    .filter((c) => !c.scheduledTaskId && !scheduledConversationIds.has(c.id) && !c.id.startsWith('cron:'))
    .filter((c) => c.messages.length > 0 || c.status === 'running' || c.id === activeConversationId)
    .sort((a, b) => b.createdAt - a.createdAt);

  const conversationGroups = useMemo(() => {
    const recentOrder = new Map<string, number>();
    const projectMap = new Map<string, { path: string; name: string; conversations: Conversation[]; latestUpdatedAt: number; recentIndex: number }>();
    const unprojected: Conversation[] = [];

    for (const [index, recentPath] of recentWorkspacePaths.entries()) {
      const path = visibleProjectPath(recentPath);
      if (!path || projectMap.has(path)) continue;
      recentOrder.set(path, index);
      projectMap.set(path, {
        path,
        name: projectNames[path] ?? projectNameFromPath(path),
        conversations: [],
        latestUpdatedAt: 0,
        recentIndex: index,
      });
    }

    for (const conv of sortedConvs) {
      const path = projectPathForConversation(conv);
      if (!path) {
        unprojected.push(conv);
        continue;
      }
      const existing = projectMap.get(path);
      if (existing) {
        existing.conversations.push(conv);
        existing.latestUpdatedAt = Math.max(existing.latestUpdatedAt, conv.updatedAt);
      } else {
        projectMap.set(path, {
          path,
          name: projectNames[path] ?? projectNameForConversation(conv, path),
          conversations: [conv],
          latestUpdatedAt: conv.updatedAt,
          recentIndex: recentOrder.get(path) ?? Number.MAX_SAFE_INTEGER,
        });
      }
    }

    const projects = [...projectMap.values()]
      .map((project) => ({
        ...project,
        conversations: project.conversations.sort((a, b) => b.updatedAt - a.updatedAt),
      }))
      .sort((a, b) => a.recentIndex - b.recentIndex || b.latestUpdatedAt - a.latestUpdatedAt);

    return {
      projects,
      unprojected: unprojected.sort((a, b) => b.updatedAt - a.updatedAt),
    };
  }, [projectNames, recentWorkspacePaths, sortedConvs]);

  const workspaceSkills = useMemo(
    () => skills.filter((skill) => skill.tags?.[0] === 'workspace'),
    [skills],
  );

  const filteredWorkspaceSkills = useMemo(() => {
    const query = skillSearch.trim().toLowerCase();
    if (!query) return workspaceSkills;
    return workspaceSkills.filter((skill) => (
      skill.name.toLowerCase().includes(query)
      || skill.description.toLowerCase().includes(query)
    ));
  }, [skillSearch, workspaceSkills]);

  const handleDeleteConversation = (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    // Save conversation data for undo before deleting
    const json = exportConversation(convId);
    deleteConversation(convId);
    if (json) {
      // Cancel any previous undo timer
      clearTimeout(undoTimerRef.current);
      setPendingDelete({ id: convId, data: json });
      undoTimerRef.current = setTimeout(() => setPendingDelete(null), 5000);
    }
  };

  const handleUndoDelete = () => {
    if (pendingDelete) {
      importConversation(pendingDelete.data);
      clearTimeout(undoTimerRef.current);
      setPendingDelete(null);
    }
  };

  const handleClearCompletedStatus = useCallback((convId: string) => {
    clearCompletedStatus(convId);
  }, [clearCompletedStatus]);

  const handleContextMenu = (e: React.MouseEvent, convId: string) => {
    e.preventDefault();
    e.stopPropagation();
    // Clamp to viewport to prevent overflow
    const menuWidth = 160, menuHeight = 120;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);
    setContextMenu({ x, y, convId });
  };

  const handleExport = async (convId: string) => {
    const json = exportConversation(convId);
    if (!json) return;
    const conv = conversations[convId];
    const defaultName = `ruyi-conversation-${conv?.title || convId}.json`;
    try {
      const filePath = await dialogBridge.save({
        defaultPath: defaultName,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (filePath) {
        await fsBridge.writeTextFile(filePath, json);
      }
    } catch (err) {
      console.error('Export failed:', err);
    }
    setContextMenu(null);
  };

  const toggleProject = (path: string) => {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openProjectMenu = (event: React.MouseEvent, path: string) => {
    event.stopPropagation();
    const x = Math.min(event.clientX, window.innerWidth - PROJECT_MENU_WIDTH - 8);
    const y = Math.min(event.clientY, window.innerHeight - PROJECT_MENU_HEIGHT - 8);
    setProjectMenu({ x, y, path });
  };

  const startProjectConversation = (path: string) => {
    startNewConversation();
    setViewMode('chat');
    window.dispatchEvent(new CustomEvent('nanobot-gui:new-chat', { detail: { projectPath: path } }));
  };

  const requestRemoveProject = (path: string) => {
    const project = conversationGroups.projects.find((item) => item.path === path);
    const projectName = project?.name ?? projectNames[path] ?? projectNameFromPath(path);
    setPendingRemoveProject({ path, name: projectName });
  };

  const openProjectSkills = async (path: string) => {
    const project = conversationGroups.projects.find((item) => item.path === path);
    const projectName = project?.name ?? projectNames[path] ?? projectNameFromPath(path);
    const availableWorkspaceSkills = new Set(workspaceSkills.map((skill) => skill.name));
    setSkillProject({ path, name: projectName });
    setSkillSearch('');
    try {
      const auth = await getProjectSkillsAuth();
      const payload = await fetchProjectSkills(auth.token, path, auth.baseUrl);
      setDraftSkillBindings(payload.skills.filter((name) => availableWorkspaceSkills.has(name)));
      setProjectSkillBindings(path, payload.skills);
    } catch {
      setDraftSkillBindings((projectSkillBindings[normalizeProjectPath(path)] ?? []).filter((name) => availableWorkspaceSkills.has(name)));
    }
  };

  const toggleDraftSkill = (name: string) => {
    setDraftSkillBindings((current) => (
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    ));
  };

  const saveProjectSkills = async () => {
    if (!skillProject) return;
    const availableWorkspaceSkills = new Set(workspaceSkills.map((skill) => skill.name));
    const skills = draftSkillBindings.filter((name) => availableWorkspaceSkills.has(name));
    try {
      const auth = await getProjectSkillsAuth();
      const payload = await saveProjectSkillsApi(auth.token, skillProject.path, skills, auth.baseUrl);
      setProjectSkillBindings(skillProject.path, payload.skills);
    } catch {
      setProjectSkillBindings(skillProject.path, skills);
    }
    setSkillProject(null);
  };

  const confirmRemoveProject = () => {
    if (!pendingRemoveProject) return;
    const project = conversationGroups.projects.find((item) => item.path === pendingRemoveProject.path);
    const projectConversations = project?.conversations ?? [];
    for (const conv of projectConversations) {
      deleteConversation(conv.id);
    }
    removeRecentPath(pendingRemoveProject.path);
    window.dispatchEvent(new CustomEvent('nanobot-gui:workspace-settings-changed'));
    setPendingRemoveProject(null);
  };

  const accountInitial = (promptHubUser?.username?.trim()[0] || '').toUpperCase();

  useEffect(() => {
    if (promptHubOpen) setPromptHubUsername(promptHubUser?.username ?? '');
  }, [promptHubOpen, promptHubUser?.username]);

  const submitPromptHubLogin = async () => {
    if (!promptHubUsername.trim() || !promptHubPassword) return;
    try {
      await loginPromptHub(promptHubUsername, promptHubPassword);
      setPromptHubPassword('');
    } catch {
      // Error is stored in promptHubStore for display.
    }
  };

  const renderConversationButton = (conv: Conversation, nested = false) => (
    <button
      key={conv.id}
      onClick={() => { switchConversation(conv.id); setViewMode('chat'); }}
      onContextMenu={(e) => handleContextMenu(e, conv.id)}
      aria-current={conv.id === activeConversationId && viewMode === 'chat' ? 'true' : undefined}
      className={cn(
        'group flex items-center gap-2 rounded-xl cursor-pointer transition-colors w-full text-left',
        nested ? 'px-3 py-2 ml-7 w-[calc(100%-1.75rem)]' : 'px-3.5 py-2.5',
        conv.id === activeConversationId && viewMode === 'chat'
          ? 'bg-[#ecebe7] text-[#29261b]'
          : 'text-[#34322d] hover:bg-[#eeeeea]'
      )}
    >
      <StatusIndicator
        status={conv.status ?? 'idle'}
        onComplete={() => handleClearCompletedStatus(conv.id)}
      />
      {editingId === conv.id ? (
        <input
          autoFocus
          defaultValue={conv.title}
          className="flex-1 text-[13px] bg-transparent border-b border-[#d97757] outline-none min-w-0"
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const val = e.target.value.trim();
            if (val && val !== conv.title) renameConversation(conv.id, val);
            setEditingId(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditingId(null);
          }}
        />
      ) : (
        <span className="flex-1 truncate text-[14px] font-medium tracking-[-0.01em]">{conv.title}</span>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => handleDeleteConversation(e, conv.id)}
        className="h-5 w-5 opacity-0 group-hover:opacity-100 text-[#656358] hover:text-red-500 hover:bg-transparent shrink-0"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </button>
  );

  return (
    <div className="flex flex-col h-full w-[260px] bg-[#f7f6f2] border-r border-[#e5e2db]">
      {/* Drag region — covers the title bar area above sidebar content (macOS overlay only) */}
      {isMacOS() && (
        <div
          className="h-7 shrink-0 [app-region:drag]"
        />
      )}
      {/* Top Navigation */}
      <nav className="px-4 pb-5 space-y-1" aria-label="Main navigation">
        <button
          onClick={() => {
            startNewConversation();
            window.dispatchEvent(new CustomEvent('nanobot-gui:new-chat'));
            setViewMode('chat');
          }}
          className={cn(
            'btn-ghost flex items-center gap-3 w-full px-3 py-2.5 text-[15px] font-medium tracking-[-0.01em] rounded-xl',
            activeConversationId === null && viewMode === 'chat'
              ? 'bg-[#ecebe7] text-[#29261b]'
              : 'text-[#34322d] hover:bg-[#eeeeea]'
          )}
        >
          <Plus className="h-[18px] w-[18px] text-[#3d3929]" strokeWidth={2} />
          <span>{t.sidebar.newTask}</span>
        </button>
        <button
          onClick={() => setViewMode('schedule')}
          className={cn(
            'btn-ghost flex items-center gap-3 w-full px-3 py-2.5 text-[15px] font-medium tracking-[-0.01em] rounded-xl',
            viewMode === 'schedule'
              ? 'bg-[#ecebe7] text-[#29261b] font-medium'
              : 'text-[#34322d] hover:bg-[#eeeeea]'
          )}
        >
          <Clock className="h-[18px] w-[18px] text-[#656358]" strokeWidth={1.75} />
          <span>{t.sidebar.scheduledTasks}</span>
          {unviewedRunCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#d97757]/15 text-[#d97757] font-medium">
              {unviewedRunCount}
            </span>
          )}
        </button>
        <button
          onClick={() => openToolbox()}
          className={cn(
            'btn-ghost flex items-center gap-3 w-full px-3 py-2.5 text-[15px] font-medium tracking-[-0.01em] rounded-xl',
            viewMode === 'toolbox'
              ? 'bg-[#ecebe7] text-[#29261b] font-medium'
              : 'text-[#34322d] hover:bg-[#eeeeea]'
          )}
        >
          <Wrench className="h-[18px] w-[18px] text-[#656358]" strokeWidth={1.75} />
          <span>{t.sidebar.toolbox}</span>
        </button>
      </nav>

      {/* Conversation List */}
      <ScrollArea className="flex-1 min-h-0 px-2">
        {conversationGroups.projects.length === 0 && conversationGroups.unprojected.length === 0 ? (
          <div className="px-4 py-3">
            <p className="text-[14px] text-[#8a867c]">{t.sidebar.noSessionsYet}</p>
          </div>
        ) : (
          <div className="space-y-5 py-2">
            {conversationGroups.projects.length > 0 && (
              <section>
                <div className="px-3 pb-2 text-[14px] font-semibold tracking-[-0.01em] text-[#8a867c]">{t.sidebar.projects}</div>
                <div className="space-y-1">
                  {conversationGroups.projects.map((project) => {
                    const collapsed = collapsedProjects.has(project.path);
                    const showAll = expandedProjects.has(project.path);
                    const visible = showAll ? project.conversations : project.conversations.slice(0, PROJECT_VISIBLE_LIMIT);
                    const hiddenCount = project.conversations.length - PROJECT_VISIBLE_LIMIT;
                    return (
                      <div key={project.path} className="space-y-0.5">
                        <div
                          className="group/project flex items-center gap-2 px-3.5 py-2 text-[15px] font-semibold tracking-[-0.01em] text-[#34322d] hover:bg-[#eeeeea] rounded-xl transition-colors w-full text-left"
                        >
                          <button
                            onClick={() => toggleProject(project.path)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            {collapsed ? (
                              <FolderClosed className="h-4 w-4 text-[#3d3929] shrink-0" />
                            ) : (
                              <FolderOpen className="h-4 w-4 text-[#3d3929] shrink-0" />
                            )}
                            <span className="truncate">{project.name}</span>
                            <ChevronRight className={cn('h-4 w-4 text-[#8a867c] shrink-0 opacity-0 transition-all group-hover/project:opacity-100', !collapsed && 'rotate-90')} />
                          </button>
                          <button
                            onClick={(event) => openProjectMenu(event, project.path)}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-[#656358] opacity-0 transition-opacity hover:bg-[#dedbd3] hover:text-[#29261b] group-hover/project:opacity-100"
                            aria-label={t.sidebar.projectMore}
                            title={t.sidebar.projectMore}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              startProjectConversation(project.path);
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-[#656358] opacity-0 transition-opacity hover:bg-[#dedbd3] hover:text-[#29261b] group-hover/project:opacity-100"
                            aria-label={t.sidebar.newProjectConversation}
                            title={t.sidebar.newProjectConversation}
                          >
                            <SquarePen className="h-4 w-4" />
                          </button>
                        </div>
                        {!collapsed && project.conversations.length === 0 && (
                          <div className="ml-7 px-3 py-1.5 text-[14px] text-[#8a867c]">{t.sidebar.noSessionsYet}</div>
                        )}
                        {!collapsed && visible.map((conv) => renderConversationButton(conv, true))}
                        {!collapsed && hiddenCount > 0 && (
                          <button
                            onClick={() => {
                              setExpandedProjects((current) => {
                                const next = new Set(current);
                                if (showAll) next.delete(project.path);
                                else next.add(project.path);
                                return next;
                              });
                            }}
                            className="ml-7 px-3 py-1.5 text-[14px] font-medium text-[#8a867c] hover:text-[#34322d] transition-colors"
                          >
                            {showAll ? t.sidebar.collapseProject : t.sidebar.expandProjectConversations}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {conversationGroups.unprojected.length > 0 && (
              <section>
                <div className="px-3 pb-2 text-[14px] font-semibold tracking-[-0.01em] text-[#8a867c]">{t.sidebar.conversations}</div>
                <div className="space-y-0.5">
                  {conversationGroups.unprojected.map((conv) => renderConversationButton(conv))}
                </div>
              </section>
            )}
          </div>
        )}
      </ScrollArea>

      {/* User Section */}
      <div className="px-3 py-2.5 shrink-0 border-t border-[#e5e2db]">
        <div className="flex items-center gap-1.5">
          <button
            onClick={openPromptHubLogin}
            className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-1.5 py-1.5 text-left transition-colors hover:bg-[#ebe9e4]"
            title={promptHubUser ? `已登录：${promptHubUser.username}` : '连接使用'}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#d8d5ce] bg-[#f7f6f3] text-[#29261b] shadow-sm">
              {promptHubUser ? (
                <span className="text-[18px] font-medium">{accountInitial}</span>
              ) : (
                <UserRound className="h-5 w-5" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <div className="truncate text-[15px] font-semibold text-[#29261b] leading-none">
                {promptHubUser?.username || '连接使用'}
              </div>
              <div className="shrink-0 rounded border border-[#d97757]/30 bg-[#d97757]/8 px-1 py-[2px] text-[9.5px] font-semibold leading-none tracking-wide text-[#d97757]">
                内测版
              </div>
            </div>
          </button>
          <button
            onClick={() => openSystemSettings(updateInfo ? 'about' : undefined)}
            className={cn(
              'btn-ghost p-1.5 rounded-md relative',
              viewMode === 'settings'
                ? 'text-[#d97757] bg-[#d97757]/10'
                : 'text-[#656358] hover:text-[#29261b] hover:bg-[#e8e5de]'
            )}
          >
            <Settings className="h-3.5 w-3.5" />
            {updateInfo && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
            )}
          </button>
          <button
            onClick={() => setGuideOpen(true)}
            className="btn-ghost p-1.5 text-[#656358] hover:text-[#29261b] hover:bg-[#e8e5de] rounded-md"
            title={t.sidebar.help}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-white rounded-lg shadow-lg border border-[#e8e4dd] py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              setEditingId(contextMenu.convId);
              setContextMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-[#3d3929] hover:bg-[#f0ede6]"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t.sidebar.renameConversation}
          </button>
          <button
            onClick={() => handleExport(contextMenu.convId)}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-[#3d3929] hover:bg-[#f0ede6]"
          >
            <Download className="h-3.5 w-3.5" />
            {t.sidebar.exportConversation}
          </button>
          <button
            onClick={(e) => {
              handleDeleteConversation(e, contextMenu.convId);
              setContextMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-red-500 hover:bg-[#f0ede6]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t.sidebar.deleteConversation}
          </button>
        </div>
      )}

      {projectMenu && (
        <div
          className="fixed z-50 bg-white rounded-lg shadow-lg border border-[#e8e4dd] py-1 min-w-[140px]"
          style={{ left: projectMenu.x, top: projectMenu.y }}
        >
          <button
            onClick={() => {
              void shellBridge.revealItemInDir(projectMenu.path);
              setProjectMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-[#3d3929] hover:bg-[#f0ede6]"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t.sidebar.openProjectLocation}
          </button>
          <button
            onClick={() => {
              void openProjectSkills(projectMenu.path);
              setProjectMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-[#3d3929] hover:bg-[#f0ede6]"
          >
            <Wrench className="h-3.5 w-3.5" />
            管理技能
          </button>
          <button
            onClick={() => {
              requestRemoveProject(projectMenu.path);
              setProjectMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-red-500 hover:bg-[#f0ede6]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t.sidebar.removeProject}
          </button>
        </div>
      )}

      {skillProject && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/10 px-4">
          <div className="w-full max-w-[500px] rounded-[20px] border border-[#e6e1d8] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.16)] overflow-hidden">
            <div className="flex items-start justify-between px-7 pt-6 pb-4">
              <div className="min-w-0">
                <h2 className="text-[22px] font-semibold leading-tight text-[#242424]">
                  管理技能
                </h2>
                <p className="mt-2.5 text-[15px] font-medium leading-snug text-[#8d8d8d] truncate">
                  {skillProject.name}
                </p>
              </div>
              <button
                onClick={() => setSkillProject(null)}
                className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg text-[#4b4b4b] hover:bg-[#f3f1ed] transition-colors"
                aria-label={t.common.close}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-7 pb-4">
              <div className="mb-3 flex h-10 items-center gap-2 rounded-[12px] border border-[#e8e5df] bg-white px-3">
                <Search className="h-4 w-4 shrink-0 text-[#8d8d8d]" />
                <input
                  value={skillSearch}
                  onChange={(event) => setSkillSearch(event.target.value)}
                  placeholder="搜索我的技能"
                  className="w-full bg-transparent text-[14px] text-[#242424] outline-none placeholder:text-[#a6a29a]"
                />
              </div>
              <div className="max-h-[260px] overflow-y-auto rounded-[12px] border border-[#eeeae3]">
                {workspaceSkills.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[13px] text-[#8d8d8d]">
                    暂无我的技能
                  </div>
                ) : filteredWorkspaceSkills.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[13px] text-[#8d8d8d]">
                    未找到技能
                  </div>
                ) : (
                  filteredWorkspaceSkills.map((skill) => {
                    const checked = draftSkillBindings.includes(skill.name);
                    return (
                      <label
                        key={skill.name}
                        className="flex cursor-pointer items-start gap-3 px-3.5 py-2.5 hover:bg-[#f8f6f2]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDraftSkill(skill.name)}
                          className="mt-1 h-4 w-4 accent-[#d97757]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium text-[#29261b]">
                            {skill.name}
                          </span>
                          <span className="line-clamp-2 text-[12px] leading-snug text-[#8d8d8d]">
                            {skill.description}
                          </span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 px-7 pb-6">
              <button
                onClick={() => setSkillProject(null)}
                className="h-10 rounded-[12px] border border-[#e8e5df] bg-white px-6 text-[15px] font-semibold text-[#242424] hover:bg-[#f8f6f2] transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={() => void saveProjectSkills()}
                className="h-10 rounded-[12px] bg-[#1f2024] px-6 text-[15px] font-semibold text-white hover:bg-[#111214] transition-colors"
              >
                {t.common.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRemoveProject && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/10 px-4">
          <div className="w-full max-w-[500px] rounded-[20px] border border-[#e6e1d8] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.16)] overflow-hidden">
            <div className="flex items-start justify-between px-7 pt-6 pb-4">
              <div>
                <h2 className="text-[22px] font-semibold leading-tight text-[#242424]">
                  移除 {pendingRemoveProject.name}?
                </h2>
                <p className="mt-2.5 text-[15px] font-medium leading-snug text-[#8d8d8d] whitespace-nowrap">
                  这将从 太资如意 中移除该项目。磁盘上的文件不会被删除。
                </p>
              </div>
              <button
                onClick={() => setPendingRemoveProject(null)}
                className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg text-[#4b4b4b] hover:bg-[#f3f1ed] transition-colors"
                aria-label={t.common.close}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex justify-end gap-3 px-7 pb-6 pt-4">
              <button
                onClick={() => setPendingRemoveProject(null)}
                className="h-10 rounded-[12px] border border-[#e8e5df] bg-white px-6 text-[15px] font-semibold text-[#242424] hover:bg-[#f8f6f2] transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={confirmRemoveProject}
                className="h-10 rounded-[12px] bg-[#fae7e7] px-6 text-[15px] font-semibold text-[#d83434] hover:bg-[#f5dddd] transition-colors"
              >
                {t.sidebar.removeProject}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Guide modal */}
      <GuideModal open={guideOpen} onClose={() => { setGuideOpen(false); setGuideShown(true); }} />

      {promptHubOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30"
          onClick={(event) => {
            if (event.target === event.currentTarget && !promptHubIsLoggingIn) closePromptHubLogin();
          }}
        >
          <div className="w-[380px] rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[17px] font-semibold text-[#29261b]">
                  {promptHubUser ? '账号' : '登录'}
                </h3>
                <p className="mt-1 text-[13px] text-[#8a867c]">
                  {promptHubUser ? '当前账号已登录。' : '输入用户名和密码。'}
                </p>
              </div>
              <button
                onClick={closePromptHubLogin}
                disabled={promptHubIsLoggingIn}
                className="rounded-lg p-1.5 text-[#656358] hover:bg-[#f5f3ee] hover:text-[#29261b] disabled:opacity-50"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {promptHubUser ? (
              <div className="rounded-xl border border-[#e8e4dd] bg-[#faf9f7] px-3 py-3">
                <div className="text-[12px] text-[#8a867c]">当前账号</div>
                <div className="mt-1 text-[14px] font-semibold text-[#29261b]">{promptHubUser.username}</div>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-[#656358]">用户名</span>
                  <input
                    value={promptHubUsername}
                    onChange={(event) => setPromptHubUsername(event.target.value)}
                    className="h-9 w-full rounded-lg border border-[#e8e4dd] bg-[#faf9f7] px-3 text-sm text-[#29261b] outline-none focus:border-[#d97757] focus:ring-2 focus:ring-[#d97757]/30"
                    autoFocus
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-[#656358]">密码</span>
                  <input
                    type="password"
                    value={promptHubPassword}
                    onChange={(event) => setPromptHubPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void submitPromptHubLogin();
                    }}
                    className="h-9 w-full rounded-lg border border-[#e8e4dd] bg-[#faf9f7] px-3 text-sm text-[#29261b] outline-none focus:border-[#d97757] focus:ring-2 focus:ring-[#d97757]/30"
                  />
                </label>
              </div>
            )}

            {promptHubError && (
              <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-600">
                {promptHubError}
              </div>
            )}

            <div className="mt-5 flex items-center justify-between gap-2">
              {promptHubUser ? (
                <button
                  onClick={() => {
                    logoutPromptHub();
                    setPromptHubPassword('');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[#656358] hover:bg-[#f5f3ee] hover:text-red-500"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  退出登录
                </button>
              ) : <span />}
              <div className="flex items-center gap-2">
                <button
                  onClick={closePromptHubLogin}
                  disabled={promptHubIsLoggingIn}
                  className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-[#656358] hover:bg-[#f5f3ee] disabled:opacity-50"
                >
                  {promptHubUser ? '关闭' : '取消'}
                </button>
                {!promptHubUser && (
                  <button
                    onClick={() => void submitPromptHubLogin()}
                    disabled={promptHubIsLoggingIn || !promptHubUsername.trim() || !promptHubPassword}
                    className="rounded-lg bg-[#29261b] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#3a3628] disabled:opacity-60"
                  >
                    {promptHubIsLoggingIn ? '登录中...' : '登录'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Undo delete toast */}
      {pendingDelete && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 bg-[#29261b] text-white rounded-xl shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200" role="alert" aria-live="assertive">
          <span className="text-sm">{t.sidebar.conversationDeleted}</span>
          <button
            onClick={handleUndoDelete}
            className="flex items-center gap-1 text-sm font-medium text-[#d97757] hover:text-[#e8956e] transition-colors"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {t.sidebar.undo}
          </button>
        </div>
      )}
    </div>
  );
}
