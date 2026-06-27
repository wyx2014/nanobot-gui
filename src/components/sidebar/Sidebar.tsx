import { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useI18n } from '@/i18n';
import { Plus, Clock, Wrench, Trash2, Settings, Download, Pencil, Undo2, HelpCircle, ChevronRight, MoreHorizontal, SquarePen, FolderOpen, FolderClosed } from 'lucide-react';
import GuideModal from '@/components/common/GuideModal';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ConversationStatus } from '@/types';
import ScheduledSection from '@/components/sidebar/ScheduledSection';
import ruyiAvatar from '@/assets/ruyi-avatar.png';
import { dialogBridge, fsBridge, shellBridge } from '@/lib/ipc-factory';
import { isMacOS } from '@/utils/platform';
import { projectNameFromPath, visibleProjectPath } from '@/core/workspace';
import type { Conversation } from '@/types';

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
const PROJECT_MENU_HEIGHT = 110;

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
  const activeTaskCount = useScheduleStore((s) => s.getActiveTaskCount());
  const scheduledTasks = useScheduleStore((s) => s.tasks);
  const recentWorkspacePaths = useWorkspaceStore((s) => s.recentPaths);
  const projectNames = useWorkspaceStore((s) => s.projectNames);
  const removeRecentPath = useWorkspaceStore((s) => s.removeRecentPath);
  const setProjectName = useWorkspaceStore((s) => s.setProjectName);
  const { t } = useI18n();

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; convId: string } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{ x: number; y: number; path: string } | null>(null);
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

  const userNickname = useSettingsStore((s) => s.userNickname);
  const userAvatar = useSettingsStore((s) => s.userAvatar);

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

  const renameProject = (path: string) => {
    const next = window.prompt(t.sidebar.renameProject, projectNames[path] ?? projectNameFromPath(path));
    if (!next?.trim()) return;
    setProjectName(path, next.trim());
  };

  const removeProject = (path: string) => {
    const project = conversationGroups.projects.find((item) => item.path === path);
    const projectName = project?.name ?? projectNames[path] ?? projectNameFromPath(path);
    const projectConversations = project?.conversations ?? [];
    const message = projectConversations.length > 0
      ? `移除项目「${projectName}」并删除其中 ${projectConversations.length} 个会话？`
      : `移除项目「${projectName}」？`;
    if (!window.confirm(message)) return;
    for (const conv of projectConversations) {
      deleteConversation(conv.id);
    }
    removeRecentPath(path);
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
          {activeTaskCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#d97757]/15 text-[#d97757] font-medium">
              {activeTaskCount}
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

      {/* Scheduled Section */}
      <ScheduledSection />

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
      <div className="px-5 py-4 shrink-0 border-t border-[#e5e2db]">
        <div className="flex items-center gap-2.5">
          {/* User avatar + nickname */}
          <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
            <img src={userAvatar || ruyiAvatar} alt="Avatar" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0 text-left flex items-center gap-1.5">
            <div className="text-[13px] font-semibold text-[#29261b] truncate">
              {userNickname || t.sidebar.defaultNickname}
            </div>
            <span className="shrink-0 px-1 py-[2px] rounded border border-[#d97757]/30 text-[#d97757] bg-[#d97757]/8 text-[9.5px] font-semibold tracking-wide leading-none">
              内测版
            </span>
          </div>
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
              renameProject(projectMenu.path);
              setProjectMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-[#3d3929] hover:bg-[#f0ede6]"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t.sidebar.renameProject}
          </button>
          <button
            onClick={() => {
              removeProject(projectMenu.path);
              setProjectMenu(null);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-red-500 hover:bg-[#f0ede6]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t.sidebar.removeProject}
          </button>
        </div>
      )}

      {/* Guide modal */}
      <GuideModal open={guideOpen} onClose={() => { setGuideOpen(false); setGuideShown(true); }} />


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
