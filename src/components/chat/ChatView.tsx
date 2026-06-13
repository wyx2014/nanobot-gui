import { useEffect, useLayoutEffect, useState } from 'react';
import { useChatStore, useActiveConversation } from '@/stores/chatStore';
import type { ImageAttachment } from '@/types';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { sendNanobotMessage } from '@/core/nanobot/chatBridge';
import { getNanobotClient } from '@/core/nanobotClient';
import type { GoalStateWsPayload, WorkspaceScopePayload, WorkspacesPayload } from '@/core/types';
import { useSettingsStore } from '@/stores/settingsStore';
import { useI18n } from '@/i18n';
import ThreadMessages from './ThreadMessages';
import ChatInput, { type ChatInputSendOptions } from './ChatInput';
import ActiveSkillsBar from './ActiveSkillsBar';
import { ChevronDown, Settings } from 'lucide-react';
import ruyiAvatar from '@/assets/ruyi-avatar.png';
import ThinkingIndicator from './ThinkingIndicator';

function formatRunDuration(startedAt: number | null): string {
  if (!startedAt) return '';
  const startedMs = startedAt > 1_000_000_000_000 ? startedAt : startedAt * 1000;
  const seconds = Math.max(0, Math.round((Date.now() - startedMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function GoalStatusBar({
  goalState,
  runStartedAt,
}: {
  goalState?: GoalStateWsPayload;
  runStartedAt: number | null;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!runStartedAt) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [runStartedAt]);

  const text = goalState?.ui_summary || goalState?.objective;
  if (!runStartedAt && !text) return null;
  return (
    <div className="mb-2 flex items-center gap-2 rounded-xl border border-[#e5e2db] bg-white/85 px-3 py-2 text-[12.5px] text-[#656358] shadow-sm">
      <span className="h-2 w-2 rounded-full bg-[#d97757]" />
      <span className="font-medium text-[#29261b]">{runStartedAt ? '执行中' : '目标'}</span>
      {runStartedAt && <span>{formatRunDuration(runStartedAt)}</span>}
      {text && <span className="min-w-0 truncate">{text}</span>}
    </div>
  );
}

export default function ChatView({
  workspaceScope,
  workspaceDefaultScope: _workspaceDefaultScope,
  workspaceControls,
  workspaceError: _workspaceError,
  onWorkspaceScopeChange: _onWorkspaceScopeChange,
}: {
  workspaceScope?: WorkspaceScopePayload | null;
  workspaceDefaultScope?: WorkspaceScopePayload | null;
  workspaceControls?: WorkspacesPayload['controls'] | null;
  workspaceError?: string | null;
  onWorkspaceScopeChange?: (scope: WorkspaceScopePayload) => void;
}) {
  const activeConv = useActiveConversation();
  const { createConversation } = useChatStore();
  const messages = activeConv?.messages ?? [];
  const { t } = useI18n();
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [goalState, setGoalState] = useState<GoalStateWsPayload | undefined>(undefined);

  const { containerRef, endRef, isAtBottom, scrollToBottom, resetToBottom } = useAutoScroll();

  // Scroll to bottom when switching conversations.
  // useLayoutEffect runs after DOM commit but before paint,
  // so the user never sees the wrong scroll position.
  const activeConvId = activeConv?.id;
  useLayoutEffect(() => {
    if (activeConvId) {
      scrollToBottom();
    }
  }, [activeConvId, scrollToBottom]);

  useEffect(() => {
    if (!activeConvId) {
      setRunStartedAt(null);
      setGoalState(undefined);
      return;
    }
    let client;
    try {
      client = getNanobotClient();
    } catch {
      setRunStartedAt(null);
      setGoalState(undefined);
      return;
    }
    setRunStartedAt(client.getRunStartedAt(activeConvId));
    setGoalState(client.getGoalState(activeConvId));
    const unsubscribeRun = client.onRunStatus((chatId, startedAt) => {
      if (chatId === activeConvId) setRunStartedAt(startedAt);
    });
    const unsubscribeChat = client.onChat(activeConvId, (ev) => {
      if (ev.event === 'goal_state') {
        setGoalState(ev.goal_state);
      } else if (ev.event === 'turn_end' && ev.goal_state != null && typeof ev.goal_state === 'object') {
        setGoalState(ev.goal_state);
      }
    });
    return () => {
      unsubscribeRun();
      unsubscribeChat();
    };
  }, [activeConvId]);

  const handleSend = async (
    text: string,
    images?: ImageAttachment[],
    welcomeWorkspacePath?: string | null,
    options?: ChatInputSendOptions,
  ) => {
    // Block sending if API key is not configured
    const currentApiKey = useSettingsStore.getState().apiKey;
    if (!currentApiKey?.trim()) {
      useSettingsStore.getState().openSystemSettings('ai-services');
      return;
    }

    let convId = activeConv?.id;
    const isNewConversation = !convId;
    if (!convId) {
      convId = createConversation(welcomeWorkspacePath ?? workspaceScope?.project_path ?? null, {
        workspaceScope: workspaceScope ?? null,
      });
    }
    if (isNewConversation && !useSettingsStore.getState().sidebarCollapsed) {
      useSettingsStore.getState().toggleSidebar();
    }
    resetToBottom();

    // Use gateway-provided scope; fall back to welcome path if provided
    let effectiveScope: WorkspaceScopePayload | null = workspaceScope ?? null;
    if (!effectiveScope && welcomeWorkspacePath) {
      const parts = welcomeWorkspacePath.split('/').filter(Boolean);
      effectiveScope = {
        project_path: welcomeWorkspacePath,
        project_name: parts[parts.length - 1] || welcomeWorkspacePath,
        access_mode: 'restricted',
        restrict_to_workspace: true,
      };
    }

    await sendNanobotMessage(convId, text, {
      images,
      workspaceScope: effectiveScope,
      cliApps: options?.cliApps,
      mcpPresets: options?.mcpPresets,
    });
  };


  // Welcome screen - new conversation state (activeConversationId is null)
  const apiKey = useSettingsStore((s) => s.apiKey);
  const needsSetup = !apiKey?.trim();

  if (!activeConv) {
    return (
      <div className="flex flex-col h-full bg-[#fbfaf7]">
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-12">
          <div className="w-full max-w-3xl">
            {/* Title */}
            <div className="text-center mb-8">
              {/* Mascot */}
              <div className="w-20 h-20 mx-auto mb-4 rounded-full overflow-hidden">
                <img src={ruyiAvatar} alt="Ruyi" className="w-full h-full object-cover" />
              </div>

              {/* Slogan */}
              <h1 className="text-[28px] font-semibold text-[#29261b] leading-tight mb-3">
                {t.chat.welcomeTitle}
              </h1>

              {/* Greeting */}
              <p className="text-[15px] text-[#656358] leading-relaxed whitespace-pre-line">
                {t.chat.welcomeSubtitle}
              </p>
            </div>

            {/* First-run setup prompt */}
            {needsSetup && (
              <div className="mb-6 mx-auto max-w-md">
                <div className="rounded-2xl border border-[#dedbd3] bg-white px-5 py-4 text-center shadow-sm">
                  <p className="text-[15px] font-medium text-[#29261b] mb-1">
                    {t.chat.setupRequired}
                  </p>
                  <p className="text-[13px] text-[#656358] mb-3">
                    {t.chat.setupRequiredDesc}
                  </p>
                  <button
                    onClick={() => useSettingsStore.getState().openSystemSettings('ai-services')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#29261b] text-white text-[13px] font-medium hover:bg-[#3d3929] transition-colors"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    {t.chat.setupButton}
                  </button>
                </div>
              </div>
            )}

            {/* Main input */}
            <div>
              <ChatInput
                variant="welcome"
                onSend={handleSend}
                workspaceScope={workspaceScope}
                workspaceControls={workspaceControls}
                onWorkspaceScopeChange={_onWorkspaceScopeChange}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 bg-[#fbfaf7]">
      {/* Messages Area */}
      <div className="relative flex-1 min-h-0 overflow-y-auto" ref={containerRef}>
        <div className="w-full max-w-4xl mx-auto px-6 md:px-10 py-8 overflow-hidden">
          <div>
            <ThreadMessages messages={messages} isStreaming={activeConv.status === 'running'} />

            {/* Thinking indicator - shown after user message but before assistant message appears */}
            {activeConv?.status === 'running' && messages.length > 0 && messages.every((m) => m.role === 'user') && (
              <div className="pl-9">
                <ThinkingIndicator />
              </div>
            )}
          </div>

          {/* Bottom sentinel */}
          <div ref={endRef} className="h-px w-full" />
        </div>

        {/* Scroll-to-bottom button */}
        {!isAtBottom && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 border border-[#706b5730] shadow-md text-[13px] text-[#656358] hover:text-[#29261b] hover:bg-white transition-all backdrop-blur-sm"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            <span>{t.chat.scrollToBottom}</span>
          </button>
        )}
      </div>

      {/* Bottom Input */}
      <div className="shrink-0 px-6 md:px-10 pb-4 pt-2 bg-gradient-to-t from-[#fbfaf7] via-[#fbfaf7] to-[#fbfaf7]/80">
        <div className="max-w-4xl mx-auto">
          <ActiveSkillsBar />
          <GoalStatusBar goalState={goalState} runStartedAt={runStartedAt} />
          <ChatInput
            variant="chat"
            onSend={handleSend}
            workspaceScope={workspaceScope}
            workspaceControls={workspaceControls}
            onWorkspaceScopeChange={_onWorkspaceScopeChange}
          />
          <p className="text-center text-[13px] text-[#8a867c] mt-3">
            {t.chat.disclaimer}
          </p>
        </div>
      </div>
    </div>
  );
}
