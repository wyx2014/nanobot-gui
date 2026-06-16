import { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useI18n } from '@/i18n';
import { Plus, Clock, Wrench, Trash2, Settings, Download, Pencil, Undo2, HelpCircle } from 'lucide-react';
import GuideModal from '@/components/common/GuideModal';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ConversationStatus } from '@/types';
import ScheduledSection from '@/components/sidebar/ScheduledSection';
import ruyiAvatar from '@/assets/ruyi-avatar.png';
import { dialogBridge, fsBridge } from '@/lib/ipc-factory';
import { isMacOS } from '@/utils/platform';

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

export default function Sidebar() {
  const { conversations, activeConversationId, startNewConversation, switchConversation, deleteConversation, renameConversation, clearCompletedStatus, exportConversation, importConversation } = useChatStore();
  const openToolbox = useSettingsStore((s) => s.openToolbox);
  const openSystemSettings = useSettingsStore((s) => s.openSystemSettings);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const updateInfo = useSettingsStore((s) => s.updateInfo);
  const activeTaskCount = useScheduleStore((s) => s.getActiveTaskCount());
  const scheduledTasks = useScheduleStore((s) => s.tasks);
  const { t } = useI18n();

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; convId: string } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Undo delete state
  const [pendingDelete, setPendingDelete] = useState<{ id: string; data: string } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Inline rename state
  const [editingId, setEditingId] = useState<string | null>(null);

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
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [contextMenu]);

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
    .filter((c) => c.messages.length > 0)
    .sort((a, b) => b.createdAt - a.createdAt);

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

      {/* Recents Section */}
      <div className="px-5 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[14px] font-medium tracking-[-0.01em] text-[#8a867c]">{t.sidebar.recents}</span>
      </div>

      {/* Conversation List */}
      <ScrollArea className="flex-1 min-h-0 px-2">
        {sortedConvs.length === 0 ? (
          <div className="px-4 py-3">
            <p className="text-[14px] text-[#8a867c]">{t.sidebar.noSessionsYet}</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {sortedConvs.map((conv) => (
              <button
                key={conv.id}
                onClick={() => { switchConversation(conv.id); setViewMode('chat'); }}
                onContextMenu={(e) => handleContextMenu(e, conv.id)}
                aria-current={conv.id === activeConversationId && viewMode === 'chat' ? 'true' : undefined}
                className={cn(
                  'group flex items-center gap-2 px-3.5 py-2.5 rounded-xl cursor-pointer transition-colors w-full text-left',
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
            ))}
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
          <div className="flex-1 min-w-0 text-left">
            <div className="text-[13px] font-semibold text-[#29261b] truncate">
              {userNickname || t.sidebar.defaultNickname}
            </div>
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
