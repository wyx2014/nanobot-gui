import { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { usePromptHubStore } from '@/stores/promptHubStore';
import { useI18n } from '@/i18n';
import { Clock, Wrench, Trash2, Settings, Download, Pencil, HelpCircle, ChevronRight, MoreHorizontal, SquarePen, FolderOpen, FolderClosed, X, Search, LogOut, UserRound } from 'lucide-react';
import ProjectMemoryDialog from '@/components/sidebar/ProjectMemoryDialog';
import { matchesConversationSearch, matchesProjectSearch } from '@/components/sidebar/conversationSearch';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ConversationStatus } from '@/types';
import { dialogBridge, fsBridge, shellBridge } from '@/lib/ipc-factory';
import { isMacOS } from '@/utils/platform';
import { normalizeProjectPath, projectNameFromPath, visibleProjectPath } from '@/core/workspace';
import type { Conversation } from '@/types';
import {
  archiveProject,
  fetchProjectSkills,
  saveProjectSkills as saveProjectSkillsApi,
} from '@/core/api';
import {
  getNanobotStatus,
  getNanobotToken,
  refreshNanobotAuth,
  syncProjectsFromGateway,
} from '@/core/nanobotClient';

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
const PROJECT_MENU_HEIGHT = 250;

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
  const { conversations, activeConversationId, startNewConversation, switchConversation, deleteConversation, renameConversation, clearCompletedStatus, exportConversation } = useChatStore();
  const openToolbox = useSettingsStore((s) => s.openToolbox);
  const openSystemSettings = useSettingsStore((s) => s.openSystemSettings);
  const setGuideShown = useSettingsStore((s) => s.setGuideShown);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const updateInfo = useSettingsStore((s) => s.updateInfo);
  const unviewedRunCount = useScheduleStore((s) => s.getUnviewedRunCount());
  const scheduledTasks = useScheduleStore((s) => s.tasks);
  const recentWorkspacePaths = useWorkspaceStore((s) => s.recentPaths);
  const gatewayProjects = useWorkspaceStore((s) => s.projects);
  const projectNames = useWorkspaceStore((s) => s.projectNames);
  const projectSkillBindings = useWorkspaceStore((s) => s.projectSkillBindings);
  const removeRecentPath = useWorkspaceStore((s) => s.removeRecentPath);
  const setProjectSkillBindings = useWorkspaceStore((s) => s.setProjectSkillBindings);
  const skills = useDiscoveryStore((s) => s.skills);
  const promptHubUser = usePromptHubStore((s) => s.user);
  const promptHubIsLoggingIn = usePromptHubStore((s) => s.isLoggingIn);
  const promptHubOpen = usePromptHubStore((s) => s.loginOpen);
  const promptHubError = usePromptHubStore((s) => s.error);
  const promptHubBaseUrl = usePromptHubStore((s) => s.baseUrl);
  const setPromptHubBaseUrl = usePromptHubStore((s) => s.setBaseUrl);
  const loginPromptHub = usePromptHubStore((s) => s.login);
  const logoutPromptHub = usePromptHubStore((s) => s.logout);
  const openPromptHubLogin = usePromptHubStore((s) => s.openLogin);
  const closePromptHubLogin = usePromptHubStore((s) => s.closeLogin);
  const { t } = useI18n();

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; convId: string } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{ x: number; y: number; path: string; id?: string; name: string } | null>(null);
  const [pendingRemoveProject, setPendingRemoveProject] = useState<{ path: string; name: string; id?: string } | null>(null);
  const [memoryProject, setMemoryProject] = useState<{ id: string; name: string } | null>(null);
  const [skillProject, setSkillProject] = useState<{ path: string; name: string } | null>(null);
  const [skillSearch, setSkillSearch] = useState('');
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [conversationSearch, setConversationSearch] = useState('');
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const [draftSkillBindings, setDraftSkillBindings] = useState<string[]>([]);
  const [promptHubUsername, setPromptHubUsername] = useState('');
  const [promptHubPassword, setPromptHubPassword] = useState('');
  const [promptHubServerUrl, setPromptHubServerUrl] = useState('');
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const conversationSearchRef = useRef<HTMLInputElement>(null);

  const [showDeleteToast, setShowDeleteToast] = useState(false);
  const deleteToastTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(deleteToastTimerRef.current), []);

  const closeConversationSearch = useCallback(() => {
    setConversationSearch('');
    setSelectedSearchIndex(0);
    setConversationSearchOpen(false);
  }, []);

  const openConversationSearch = useCallback(() => {
    setSelectedSearchIndex(0);
    setConversationSearchOpen(true);
  }, []);

  useEffect(() => {
    if (!conversationSearchOpen) return;
    const frame = requestAnimationFrame(() => conversationSearchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [conversationSearchOpen]);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && conversationSearchOpen) {
        event.preventDefault();
        closeConversationSearch();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openConversationSearch();
      }
    };

    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, [closeConversationSearch, conversationSearchOpen, openConversationSearch]);

  // Inline rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set());

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

  const sortedConvs = useMemo(
    () => Object.values(conversations)
      .filter((c) => !c.scheduledTaskId && !scheduledConversationIds.has(c.id) && !c.id.startsWith('cron:'))
      .filter((c) => c.hasHistory || !!c.sessionId || c.messages.length > 0 || c.status === 'running' || c.id === activeConversationId)
      .sort((a, b) => b.createdAt - a.createdAt),
    [activeConversationId, conversations, scheduledConversationIds],
  );

  const conversationGroups = useMemo(() => {
    const recentOrder = new Map<string, number>();
    const gatewayProjectById = new Map(gatewayProjects.map((project) => [project.id, project]));
    const gatewayProjectByPath = new Map(
      gatewayProjects.map((project) => [normalizeProjectPath(project.rootPath), project]),
    );
    const projectMap = new Map<string, {
      key: string;
      id?: string;
      path: string;
      name: string;
      conversations: Conversation[];
      latestUpdatedAt: number;
      recentIndex: number;
    }>();
    const unprojected: Conversation[] = [];

    for (const project of gatewayProjects) {
      if (project.kind !== 'workspace' || project.status === 'archived') continue;
      const path = visibleProjectPath(project.rootPath);
      if (!path) continue;
      projectMap.set(project.id, {
        key: project.id,
        id: project.id,
        path,
        name: projectNames[path] ?? project.name,
        conversations: [],
        latestUpdatedAt: project.updatedAt,
        recentIndex: Number.MAX_SAFE_INTEGER,
      });
    }

    for (const [index, recentPath] of recentWorkspacePaths.entries()) {
      const path = visibleProjectPath(recentPath);
      if (!path) continue;
      const gatewayProject = gatewayProjectByPath.get(normalizeProjectPath(path));
      const key = gatewayProject?.id ?? `path:${path}`;
      if (projectMap.has(key)) {
        const existing = projectMap.get(key);
        if (existing) existing.recentIndex = Math.min(existing.recentIndex, index);
        continue;
      }
      recentOrder.set(path, index);
      projectMap.set(key, {
        key,
        id: gatewayProject?.id,
        path,
        name: projectNames[path] ?? gatewayProject?.name ?? projectNameFromPath(path),
        conversations: [],
        latestUpdatedAt: 0,
        recentIndex: index,
      });
    }

    for (const conv of sortedConvs) {
      const gatewayProject = conv.projectId
        ? gatewayProjectById.get(conv.projectId)
        : undefined;
      if (gatewayProject && gatewayProject.kind !== 'workspace') {
        unprojected.push(conv);
        continue;
      }
      const path = visibleProjectPath(
        gatewayProject?.rootPath ?? projectPathForConversation(conv),
      );
      if (!path) {
        unprojected.push(conv);
        continue;
      }
      const pathProject = gatewayProject
        ?? gatewayProjectByPath.get(normalizeProjectPath(path));
      const key = pathProject?.id ?? `path:${path}`;
      const existing = projectMap.get(key);
      if (existing) {
        existing.conversations.push(conv);
        existing.latestUpdatedAt = Math.max(existing.latestUpdatedAt, conv.updatedAt);
      } else {
        projectMap.set(key, {
          key,
          id: pathProject?.id,
          path,
          name: projectNames[path] ?? pathProject?.name ?? projectNameForConversation(conv, path),
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
  }, [gatewayProjects, projectNames, recentWorkspacePaths, sortedConvs]);

  const searchConversationEntries = useMemo(() => {
    const entries = conversationGroups.projects.flatMap((project) => (
      project.conversations.map((conversation) => ({
        conversation,
        projectName: project.name,
        projectPath: project.path,
      }))
    ));

    entries.push(...conversationGroups.unprojected.map((conversation) => ({
      conversation,
      projectName: '',
      projectPath: '',
    })));

    return entries.sort((a, b) => b.conversation.updatedAt - a.conversation.updatedAt);
  }, [conversationGroups]);

  const searchResults = useMemo(() => {
    const query = conversationSearch.trim();
    const matchingEntries = query
      ? searchConversationEntries.filter((entry) => (
        matchesProjectSearch(query, entry.projectName, entry.projectPath)
        || matchesConversationSearch(
          entry.conversation,
          query,
          [entry.projectName, entry.projectPath],
        )
      ))
      : searchConversationEntries;

    return matchingEntries.slice(0, 9);
  }, [conversationSearch, searchConversationEntries]);

  const hasVisibleConversations = conversationGroups.projects.length > 0
    || conversationGroups.unprojected.length > 0;

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
    deleteConversation(convId);
    clearTimeout(deleteToastTimerRef.current);
    setShowDeleteToast(true);
    deleteToastTimerRef.current = setTimeout(() => setShowDeleteToast(false), 5000);
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

  const openProjectMenu = (event: React.MouseEvent, project: { path: string; id?: string; name: string }) => {
    event.stopPropagation();
    const x = Math.min(event.clientX, window.innerWidth - PROJECT_MENU_WIDTH - 8);
    const y = Math.min(event.clientY, window.innerHeight - PROJECT_MENU_HEIGHT - 8);
    setProjectMenu({ x, y, path: project.path, id: project.id, name: project.name });
  };

  const startProjectConversation = (path: string) => {
    startNewConversation();
    setViewMode('chat');
    window.dispatchEvent(new CustomEvent('nanobot-gui:new-chat', { detail: { projectPath: path } }));
  };

  const requestRemoveProject = (path: string) => {
    const project = conversationGroups.projects.find((item) => item.path === path);
    const projectName = project?.name ?? projectNames[path] ?? projectNameFromPath(path);
    setPendingRemoveProject({ path, name: projectName, id: project?.id });
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

  const confirmRemoveProject = async () => {
    if (!pendingRemoveProject) return;
    const project = conversationGroups.projects.find((item) => item.path === pendingRemoveProject.path);
    try {
      if (pendingRemoveProject.id) {
        const auth = await getProjectSkillsAuth();
        await archiveProject(auth.token, pendingRemoveProject.id, auth.baseUrl);
        await syncProjectsFromGateway();
      }
      const projectConversations = project?.conversations ?? [];
      for (const conv of projectConversations) {
        deleteConversation(conv.id);
      }
      removeRecentPath(pendingRemoveProject.path);
      window.dispatchEvent(new CustomEvent('nanobot-gui:workspace-settings-changed'));
      setPendingRemoveProject(null);
    } catch (error) {
      console.error('Project archive failed:', error);
    }
  };

  const accountInitial = (promptHubUser?.username?.trim()[0] || '').toUpperCase();

  useEffect(() => {
    if (!promptHubOpen) return;
    setPromptHubUsername(promptHubUser?.username ?? '');
    setPromptHubServerUrl(promptHubBaseUrl);
  }, [promptHubBaseUrl, promptHubOpen, promptHubUser?.username]);

  const submitPromptHubLogin = async () => {
    const serverUrl = promptHubServerUrl.trim().replace(/\/+$/, '');
    if (!promptHubUsername.trim() || !promptHubPassword || !/^https?:\/\//i.test(serverUrl)) return;
    try {
      setPromptHubBaseUrl(serverUrl);
      await loginPromptHub(promptHubUsername, promptHubPassword);
      setPromptHubPassword('');
    } catch {
      // Error is stored in promptHubStore for display.
    }
  };

  const startNewChat = () => {
    startNewConversation();
    window.dispatchEvent(new CustomEvent('nanobot-gui:new-chat'));
    setViewMode('chat');
  };

  const openSearchResult = (conversationId: string) => {
    switchConversation(conversationId);
    setViewMode('chat');
    closeConversationSearch();
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const selectableCount = searchResults.length + 1;
    const currentIndex = Math.min(selectedSearchIndex, selectableCount - 1);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedSearchIndex((currentIndex + 1) % selectableCount);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedSearchIndex((currentIndex - 1 + selectableCount) % selectableCount);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const result = searchResults[currentIndex];
      if (result) openSearchResult(result.conversation.id);
      else {
        closeConversationSearch();
        startNewChat();
      }
      return;
    }

    const modifierPressed = event.metaKey || event.ctrlKey;
    if (modifierPressed && /^[1-9]$/.test(event.key)) {
      const shortcutIndex = Number(event.key) - 1;
      const result = searchResults[shortcutIndex];
      if (result) {
        event.preventDefault();
        openSearchResult(result.conversation.id);
      }
      return;
    }
    if (modifierPressed && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      closeConversationSearch();
      startNewChat();
    }
  };

  const renderConversationButton = (conv: Conversation, nested = false) => (
    <button
      key={conv.id}
      onClick={() => { switchConversation(conv.id); setViewMode('chat'); }}
      onContextMenu={(e) => handleContextMenu(e, conv.id)}
      aria-current={conv.id === activeConversationId && viewMode === 'chat' ? 'true' : undefined}
      className={cn(
        'group flex h-8 items-center gap-2 rounded-lg cursor-pointer transition-colors w-full text-left',
        nested ? 'ml-6 w-[calc(100%-1.5rem)] px-3' : 'px-3',
        conv.id === activeConversationId && viewMode === 'chat'
          ? 'bg-[#ecebe7] text-[#29261b] dark:bg-[#383838] dark:text-[#f3f0e8]'
          : 'text-[#4b4943] hover:bg-[#eeeeea] dark:text-[#d8d4cc] dark:hover:bg-[#333]'
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
        <span
          className={cn(
            'flex-1 truncate text-[14px] leading-5 tracking-[-0.01em]',
            conv.id === activeConversationId && viewMode === 'chat' ? 'font-medium' : 'font-normal',
          )}
        >
          {conv.title}
        </span>
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
    <div className="flex flex-col h-full w-[260px] bg-[#f7f6f2] border-r border-[#e5e2db] dark:bg-[#242424] dark:border-[#3d3d3d]">
      {/* Layout spacer for the macOS title-bar overlay. The shared App drag
          region starts after the traffic lights and sidebar toggle. */}
      {isMacOS() && (
        <div className="h-9 shrink-0" />
      )}
      <header className="shrink-0 px-3 pb-2.5 pt-2.5">
        <div className="flex h-9 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center px-1.5 text-[20px] font-semibold leading-6 tracking-[-0.025em] text-[#34322d] dark:text-[#f3f0e8]">
            <span className="truncate">{t.common.appName}</span>
          </div>
          <button
            onClick={openConversationSearch}
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#656358] transition-colors hover:bg-[#e8e5de] hover:text-[#29261b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/35 dark:text-[#c4c0b6] dark:hover:bg-[#383838] dark:hover:text-white',
              conversationSearchOpen && 'bg-[#e8e5de] text-[#29261b] dark:bg-[#383838] dark:text-white',
            )}
            aria-label={t.sidebar.searchConversations}
            aria-keyshortcuts="Meta+K Control+K"
            aria-pressed={conversationSearchOpen}
            title={`${t.sidebar.searchConversations} (${isMacOS() ? '⌘K' : 'Ctrl+K'})`}
          >
            <Search className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {/* Top Navigation */}
      <nav className="space-y-0.5 px-3 pb-4" aria-label="Main navigation">
        <button
          onClick={startNewChat}
          className={cn(
            'btn-ghost flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[15px] font-medium leading-5 tracking-[-0.01em]',
            activeConversationId === null && viewMode === 'chat'
              ? 'bg-[#ecebe7] text-[#29261b] dark:bg-[#383838] dark:text-[#f3f0e8]'
              : 'text-[#34322d] hover:bg-[#eeeeea] dark:text-[#e3dfd7] dark:hover:bg-[#333]'
          )}
        >
          <SquarePen className="h-[18px] w-[18px] text-[#3d3929] dark:text-[#dedad2]" strokeWidth={1.8} />
          <span>{t.sidebar.newTask}</span>
        </button>
        <button
          onClick={() => setViewMode('schedule')}
          className={cn(
            'btn-ghost flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[15px] font-medium leading-5 tracking-[-0.01em]',
            viewMode === 'schedule'
              ? 'bg-[#ecebe7] text-[#29261b] font-medium dark:bg-[#383838] dark:text-[#f3f0e8]'
              : 'text-[#34322d] hover:bg-[#eeeeea] dark:text-[#e3dfd7] dark:hover:bg-[#333]'
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
            'btn-ghost flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[15px] font-medium leading-5 tracking-[-0.01em]',
            viewMode === 'toolbox'
              ? 'bg-[#ecebe7] text-[#29261b] font-medium dark:bg-[#383838] dark:text-[#f3f0e8]'
              : 'text-[#34322d] hover:bg-[#eeeeea] dark:text-[#e3dfd7] dark:hover:bg-[#333]'
          )}
        >
          <Wrench className="h-[18px] w-[18px] text-[#656358]" strokeWidth={1.75} />
          <span>{t.sidebar.toolbox}</span>
        </button>
      </nav>

      {/* Conversation List */}
      <ScrollArea className="flex-1 min-h-0 px-2">
        {!hasVisibleConversations ? (
          <div className="px-4 py-3">
            <p className="text-[14px] text-[#8a867c] dark:text-[#aaa69d]">
              {t.sidebar.noSessionsYet}
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {conversationGroups.projects.length > 0 && (
              <section>
                <div className="px-3 pb-1.5 text-[13px] font-semibold leading-5 tracking-[-0.01em] text-[#8a867c]">{t.sidebar.projects}</div>
                <div className="space-y-0.5">
                  {conversationGroups.projects.map((project) => {
                    const collapsed = collapsedProjects.has(project.key);
                    const showAll = expandedProjects.has(project.key);
                    const visible = showAll ? project.conversations : project.conversations.slice(0, PROJECT_VISIBLE_LIMIT);
                    const hiddenCount = project.conversations.length - PROJECT_VISIBLE_LIMIT;
                    return (
                      <div key={project.key} className="space-y-px">
                        <div
                          className="group/project flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-[14px] font-semibold leading-5 tracking-[-0.01em] text-[#34322d] transition-colors hover:bg-[#eeeeea] dark:text-[#e3dfd7] dark:hover:bg-[#333]"
                        >
                          <button
                            onClick={() => toggleProject(project.key)}
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
                            onClick={(event) => openProjectMenu(event, project)}
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
                          <div className="ml-6 h-8 px-3 text-[13px] leading-8 text-[#8a867c]">{t.sidebar.noSessionsYet}</div>
                        )}
                        {!collapsed && visible.map((conv) => renderConversationButton(conv, true))}
                        {!collapsed && hiddenCount > 0 && (
                          <button
                            onClick={() => {
                              setExpandedProjects((current) => {
                                const next = new Set(current);
                                if (showAll) next.delete(project.key);
                                else next.add(project.key);
                                return next;
                              });
                            }}
                            className="ml-6 h-8 px-3 text-[13px] font-medium leading-8 text-[#8a867c] transition-colors hover:text-[#34322d]"
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
                <div className="px-3 pb-1.5 text-[13px] font-semibold leading-5 tracking-[-0.01em] text-[#8a867c]">{t.sidebar.recents}</div>
                <div className="space-y-px">
                  {conversationGroups.unprojected.map((conv) => renderConversationButton(conv))}
                </div>
              </section>
            )}
          </div>
        )}
      </ScrollArea>

      {/* User Section */}
      <div className="shrink-0 border-t border-[#e5e2db] px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={openPromptHubLogin}
            className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-[#ebe9e4]"
            title={promptHubUser ? `已登录：${promptHubUser.username}` : '连接使用'}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#d8d5ce] bg-[#f7f6f3] text-[#29261b]">
              {promptHubUser ? (
                <span className="text-[13px] font-medium">{accountInitial}</span>
              ) : (
                <UserRound className="h-4 w-4" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 items-center">
              <div className="truncate text-[14px] font-semibold leading-5 text-[#29261b]">
                {promptHubUser?.username || '连接使用'}
              </div>
            </div>
          </button>
          <button
            onClick={() => openSystemSettings('general')}
            className={cn(
              'btn-ghost relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
              viewMode === 'settings'
                ? 'text-[#d97757] bg-[#d97757]/10'
                : 'text-[#656358] hover:text-[#29261b] hover:bg-[#e8e5de]'
            )}
          >
            <Settings className="h-4 w-4" />
            {updateInfo && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
            )}
          </button>
          <button
            onClick={() => setGuideShown(false)}
            className="btn-ghost flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#656358] hover:bg-[#e8e5de] hover:text-[#29261b]"
            title={t.sidebar.help}
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </div>
      </div>

      {conversationSearchOpen && createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-start justify-center bg-black/20 px-6 pt-[9vh] backdrop-blur-[1px] animate-in fade-in duration-150"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConversationSearch();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.sidebar.searchConversations}
            data-testid="conversation-search-dialog"
            className="flex max-h-[min(720px,82vh)] w-full max-w-[760px] flex-col overflow-hidden rounded-[28px] border border-black/5 bg-[#fbfbfa] shadow-[0_24px_70px_rgba(0,0,0,0.22)] dark:border-white/10 dark:bg-[#272727]"
          >
            <div className="shrink-0 px-7 pb-4 pt-5">
              <input
                ref={conversationSearchRef}
                value={conversationSearch}
                onChange={(event) => {
                  setConversationSearch(event.target.value);
                  setSelectedSearchIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder={t.sidebar.searchPlaceholder}
                className="h-10 w-full bg-transparent text-[22px] font-medium tracking-[-0.02em] text-[#34322d] outline-none placeholder:text-[#9d9a94] dark:text-[#f3f0e8] dark:placeholder:text-[#8b8b8b]"
                aria-label={t.sidebar.searchConversations}
                aria-controls="conversation-search-results"
                aria-activedescendant={`conversation-search-option-${Math.min(selectedSearchIndex, searchResults.length)}`}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="min-h-0 overflow-y-auto px-2 pb-4">
              <section aria-labelledby="conversation-search-heading">
                <div
                  id="conversation-search-heading"
                  className="px-5 pb-2 pt-1 text-[14px] font-semibold text-[#8a867c] dark:text-[#aaa69d]"
                >
                  {t.sidebar.searchChats}
                </div>
                <div id="conversation-search-results" role="listbox" className="space-y-0.5">
                  {searchResults.length > 0 ? searchResults.map((entry, index) => {
                    const selected = selectedSearchIndex === index;
                    return (
                      <button
                        id={`conversation-search-option-${index}`}
                        key={entry.conversation.id}
                        role="option"
                        aria-selected={selected}
                        onMouseEnter={() => setSelectedSearchIndex(index)}
                        onClick={() => openSearchResult(entry.conversation.id)}
                        className={cn(
                          'flex h-12 w-full items-center gap-3 rounded-2xl px-5 text-left transition-colors',
                          selected
                            ? 'bg-[#ececeb] text-[#29261b] dark:bg-[#3a3a3a] dark:text-[#f3f0e8]'
                            : 'text-[#4b4944] hover:bg-[#f1f1ef] dark:text-[#dedad2] dark:hover:bg-[#333]',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                          {entry.conversation.title}
                        </span>
                        {entry.projectName && (
                          <span className="max-w-[150px] shrink-0 truncate text-[14px] text-[#9b9891] dark:text-[#989898]">
                            {entry.projectName}
                          </span>
                        )}
                        <kbd className="shrink-0 rounded-lg bg-[#e4e4e2] px-2 py-1 text-[12px] font-medium leading-none text-[#85827c] dark:bg-[#454545] dark:text-[#b8b8b8]">
                          {isMacOS() ? `⌘${index + 1}` : `Ctrl+${index + 1}`}
                        </kbd>
                      </button>
                    );
                  }) : (
                    <div className="px-5 py-4 text-[14px] text-[#8a867c] dark:text-[#aaa69d]">
                      {conversationSearch.trim() ? t.sidebar.noSearchResults : t.sidebar.noSessionsYet}
                    </div>
                  )}
                </div>
              </section>

              <section className="mt-3" aria-labelledby="conversation-search-recommended">
                <div
                  id="conversation-search-recommended"
                  className="px-5 pb-2 pt-1 text-[14px] font-semibold text-[#8a867c] dark:text-[#aaa69d]"
                >
                  {t.sidebar.recommended}
                </div>
                <button
                  id={`conversation-search-option-${searchResults.length}`}
                  role="option"
                  aria-selected={selectedSearchIndex === searchResults.length}
                  onMouseEnter={() => setSelectedSearchIndex(searchResults.length)}
                  onClick={() => {
                    closeConversationSearch();
                    startNewChat();
                  }}
                  className={cn(
                    'flex h-12 w-full items-center gap-3 rounded-2xl px-5 text-left transition-colors',
                    selectedSearchIndex === searchResults.length
                      ? 'bg-[#ececeb] text-[#29261b] dark:bg-[#3a3a3a] dark:text-[#f3f0e8]'
                      : 'text-[#4b4944] hover:bg-[#f1f1ef] dark:text-[#dedad2] dark:hover:bg-[#333]',
                  )}
                >
                  <SquarePen className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{t.sidebar.newTask}</span>
                  <kbd className="shrink-0 rounded-lg bg-[#e4e4e2] px-2 py-1 text-[12px] font-medium leading-none text-[#85827c] dark:bg-[#454545] dark:text-[#b8b8b8]">
                    {isMacOS() ? '⌘N' : 'Ctrl+N'}
                  </kbd>
                </button>
              </section>
            </div>
          </div>
        </div>,
        document.body,
      )}

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
          {projectMenu.id ? (
            <>
              <button
                onClick={() => {
                  setMemoryProject({ id: projectMenu.id!, name: projectMenu.name });
                  setProjectMenu(null);
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-[#3d3929] hover:bg-[#f0ede6]"
              >
                <span className="flex h-3.5 w-3.5 items-center justify-center text-[13px]">◌</span>
                {t.projectMemory.menu}
              </button>
            </>
          ) : null}
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

      {memoryProject && (
        <ProjectMemoryDialog
          project={memoryProject}
          onClose={() => setMemoryProject(null)}
        />
      )}

      {skillProject && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 px-4 backdrop-blur-[1px] animate-in fade-in duration-150">
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
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 px-4 backdrop-blur-[1px] animate-in fade-in duration-150">
          <div className="w-full max-w-[500px] rounded-[20px] border border-[#e6e1d8] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.16)] overflow-hidden">
            <div className="flex items-start justify-between px-7 pt-6 pb-4">
              <div>
                <h2 className="text-[22px] font-semibold leading-tight text-[#242424]">
                  移除 {pendingRemoveProject.name}?
                </h2>
                <p className="mt-2.5 text-[15px] font-medium leading-snug text-[#8d8d8d] whitespace-nowrap">
                  这将从 TPACowork 中移除该项目。磁盘上的文件不会被删除。
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
                onClick={() => void confirmRemoveProject()}
                className="h-10 rounded-[12px] bg-[#fae7e7] px-6 text-[15px] font-semibold text-[#d83434] hover:bg-[#f5dddd] transition-colors"
              >
                {t.sidebar.removeProject}
              </button>
            </div>
          </div>
        </div>
      )}

      {promptHubOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/20 backdrop-blur-[1px] animate-in fade-in duration-150"
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
                  <span className="mb-1 block text-[12px] font-medium text-[#656358]">服务器地址</span>
                  <input
                    type="url"
                    value={promptHubServerUrl}
                    onChange={(event) => setPromptHubServerUrl(event.target.value)}
                    placeholder="https://hub.example.com"
                    className="h-9 w-full rounded-lg border border-[#e8e4dd] bg-[#faf9f7] px-3 text-sm text-[#29261b] outline-none focus:border-[#d97757] focus:ring-2 focus:ring-[#d97757]/30"
                  />
                  <span className="mt-1 block text-[11px] text-[#9a958b]">
                    手机端和桌面端必须使用同一个 PromptHub 地址。
                  </span>
                </label>
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
                    disabled={
                      promptHubIsLoggingIn
                      || !promptHubUsername.trim()
                      || !promptHubPassword
                      || !/^https?:\/\//i.test(promptHubServerUrl.trim())
                    }
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

      {showDeleteToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-[#29261b] text-white rounded-xl shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200" role="alert" aria-live="assertive">
          <span className="text-sm">{t.sidebar.conversationDeleted}</span>
        </div>
      )}
    </div>
  );
}
