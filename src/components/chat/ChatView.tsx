import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useChatStore, useActiveConversation } from '@/stores/chatStore';
import type { ImageAttachment, Message } from '@/types';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { useNanobotStream, type SendImage, type SendOptions } from '@/hooks/useNanobotStream';
import {
  getGatewayBaseUrl,
  getNanobotClient,
  getNanobotToken,
  mapWebuiThreadToGuiMessages,
  syncSessionsFromGateway,
} from '@/core/nanobotClient';
import type { GoalStateWsPayload, UIMessage, WorkspaceScopePayload, WorkspacesPayload } from '@/core/types';
import { fetchWebuiThread } from '@/core/api';
import { conversationIdToSessionKey } from '@/core/sessionKey';
import { useSettingsStore } from '@/stores/settingsStore';
import { useI18n } from '@/i18n';
import ThreadMessages from './ThreadMessages';
import ChatInput, { type ChatInputSendOptions } from './ChatInput';
import ActiveSkillsBar from './ActiveSkillsBar';
import { ChevronDown, Settings } from 'lucide-react';
import ruyiAvatar from '@/assets/ruyi-avatar.png';
import ThinkingIndicator from './ThinkingIndicator';
import StreamErrorNotice from './StreamErrorNotice';
import { normalizeLegacyLongTaskMessages } from '@/core/nanobot/thread-display-compat';
import { scrubSubagentUiMessages } from '@/core/nanobot/subagent-channel-display';

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

interface PendingFirstMessage {
  text: string;
  images?: ImageAttachment[];
  options?: ChatInputSendOptions;
  workspaceScope?: WorkspaceScopePayload | null;
}

function imageAttachmentsToSendImages(images?: ImageAttachment[]): SendImage[] | undefined {
  if (!images?.length) return undefined;
  return images.map((image) => {
    const dataUrl = `data:${image.mediaType};base64,${image.data}`;
    return {
      media: { data_url: dataUrl },
      preview: { url: dataUrl },
    };
  });
}

function projectWebuiThreadMessages(messages: UIMessage[]): UIMessage[] {
  return scrubSubagentUiMessages(normalizeLegacyLongTaskMessages(messages));
}

function lastMessageLooksPending(messages: UIMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last?.kind === 'trace';
}

function sendImagesFromUiMessage(message: UIMessage): SendImage[] | undefined {
  const images = message.images
    ?.map((image) => image.url)
    .filter((url): url is string => !!url && url.startsWith('data:image/'))
    .map((dataUrl) => ({
      media: { data_url: dataUrl },
      preview: { url: dataUrl },
    }));
  return images?.length ? images : undefined;
}

function scopeWithAccessMode(scope: WorkspaceScopePayload, mode: 'restricted' | 'full'): WorkspaceScopePayload {
  return {
    ...scope,
    access_mode: mode,
    restrict_to_workspace: mode === 'restricted',
  };
}

export default function ChatView({
  workspaceScope,
  workspaceDefaultScope,
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
  const { createConversation, setConversationStatus } = useChatStore();
  const { t } = useI18n();
  const [historyMessages, setHistoryMessages] = useState<UIMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const pendingFirstRef = useRef<PendingFirstMessage | null>(null);

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
      setHistoryMessages([]);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    (async () => {
      try {
        const token = getNanobotToken();
        const base = getGatewayBaseUrl();
        const thread = await fetchWebuiThread(token, conversationIdToSessionKey(activeConvId), base);
        if (cancelled) return;
        const ui = projectWebuiThreadMessages((thread?.messages ?? []).map((message, index) => ({
          ...message,
          id: message.id ?? `hist-${index}`,
          createdAt: typeof message.createdAt === 'number' ? message.createdAt : Date.now(),
        })));
        setHistoryMessages(ui);
        setHistoryVersion((value) => value + 1);
      } catch {
        if (!cancelled) {
          setHistoryMessages([]);
          setHistoryVersion((value) => value + 1);
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeConvId]);

  const handleTurnEnd = useCallback(() => {
    void syncSessionsFromGateway();
  }, []);

  const stream = useNanobotStream(
    activeConvId ?? null,
    historyMessages,
    lastMessageLooksPending(historyMessages),
    handleTurnEnd,
  );

  useEffect(() => {
    if (!activeConvId || historyLoading) return;
    stream.setMessages((current) => {
      const projected = projectWebuiThreadMessages(historyMessages);
      if (projected.length === 0 && current.length > 0) return current;
      return projected;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId, historyVersion, historyLoading]);

  useEffect(() => {
    if (!activeConvId) return;
    setConversationStatus(activeConvId, stream.isStreaming ? 'running' : 'idle');
  }, [activeConvId, setConversationStatus, stream.isStreaming]);

  useEffect(() => {
    if (!activeConvId) return;
    const pending = pendingFirstRef.current;
    if (!pending) return;
    pendingFirstRef.current = null;
    const options: SendOptions = {
      workspaceScope: pending.workspaceScope,
      ...(pending.options?.cliApps?.length ? { cliApps: pending.options.cliApps } : {}),
      ...(pending.options?.mcpPresets?.length ? { mcpPresets: pending.options.mcpPresets } : {}),
    };
    stream.send(pending.text, imageAttachmentsToSendImages(pending.images), options);
  }, [activeConvId, stream]);

  const displayMessages = useMemo(
    () => mapWebuiThreadToGuiMessages(stream.messages),
    [stream.messages],
  );

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

    // Use gateway-provided scope; fall back to welcome path if provided
    let effectiveScope: WorkspaceScopePayload | null = workspaceScope ?? null;
    if (!effectiveScope && welcomeWorkspacePath) {
      const parts = welcomeWorkspacePath.split('/').filter(Boolean);
      const defaultAccessMode = workspaceDefaultScope?.access_mode === 'full' ? 'full' : 'restricted';
      effectiveScope = {
        project_path: welcomeWorkspacePath,
        project_name: parts[parts.length - 1] || welcomeWorkspacePath,
        access_mode: defaultAccessMode,
        restrict_to_workspace: defaultAccessMode === 'restricted',
      };
    }

    const sendOptions: ChatInputSendOptions = {
      ...(options?.cliApps?.length ? { cliApps: options.cliApps } : {}),
      ...(options?.mcpPresets?.length ? { mcpPresets: options.mcpPresets } : {}),
    };
    const wireOptions: SendOptions = {
      workspaceScope: effectiveScope,
      ...(sendOptions.cliApps?.length ? { cliApps: sendOptions.cliApps } : {}),
      ...(sendOptions.mcpPresets?.length ? { mcpPresets: sendOptions.mcpPresets } : {}),
    };

    let convId = activeConv?.id;
    const isNewConversation = !convId;
    if (!convId) {
      pendingFirstRef.current = {
        text,
        images,
        options: sendOptions,
        workspaceScope: effectiveScope,
      };
      convId = createConversation(welcomeWorkspacePath ?? effectiveScope?.project_path ?? null, {
        workspaceScope: effectiveScope,
      });
    } else {
      stream.send(text, imageAttachmentsToSendImages(images), wireOptions);
    }
    if (isNewConversation && !useSettingsStore.getState().sidebarCollapsed) {
      useSettingsStore.getState().toggleSidebar();
    }
    resetToBottom();
  };

  const runStartedAt = stream.runStartedAt;
  const goalState = stream.goalState;

  const resendFromUserMessage = useCallback((
    userMessage: UIMessage,
    content: string,
    overrideWorkspaceScope?: WorkspaceScopePayload | null,
  ) => {
    const sendImages = sendImagesFromUiMessage(userMessage);
    const effectiveScope = overrideWorkspaceScope ?? workspaceScope;
    const options: SendOptions = {
      workspaceScope: effectiveScope,
      ...(userMessage.cliApps?.length ? { cliApps: userMessage.cliApps } : {}),
      ...(userMessage.mcpPresets?.length ? { mcpPresets: userMessage.mcpPresets } : {}),
    };
    stream.setMessages((current) => {
      const index = current.findIndex((message) => message.id === userMessage.id);
      if (index < 0) return current;
      return current.slice(0, index);
    });
    stream.send(content, sendImages, options);
    resetToBottom();
  }, [resetToBottom, stream, workspaceScope]);

  const handleEditUserMessage = useCallback((message: Message, newContent: string) => {
    const trimmed = newContent.trim();
    if (!trimmed) return;
    const userMessage = stream.messages.find((item) => item.id === message.id && item.role === 'user');
    if (!userMessage) return;
    resendFromUserMessage(userMessage, trimmed);
  }, [resendFromUserMessage, stream.messages]);

  const handleRegenerateAssistant = useCallback((message: Message) => {
    const assistantIndex = stream.messages.findIndex((item) => item.id === message.id);
    if (assistantIndex < 0) return;
    for (let i = assistantIndex - 1; i >= 0; i -= 1) {
      const candidate = stream.messages[i];
      if (candidate.role !== 'user') continue;
      resendFromUserMessage(candidate, candidate.content);
      return;
    }
  }, [resendFromUserMessage, stream.messages]);

  const handleAllowFullAccessAndRetry = useCallback(() => {
    if (!workspaceScope) return;
    const fullScope = scopeWithAccessMode(workspaceScope, 'full');
    _onWorkspaceScopeChange?.(fullScope);
    stream.dismissStreamError();
    const retry = () => {
      for (let i = stream.messages.length - 1; i >= 0; i -= 1) {
        const candidate = stream.messages[i];
        if (candidate.role !== 'user') continue;
        resendFromUserMessage(candidate, candidate.content, fullScope);
        return;
      }
    };
    if (stream.isStreaming) {
      stream.stop();
      window.setTimeout(retry, 250);
      return;
    }
    retry();
  }, [_onWorkspaceScopeChange, resendFromUserMessage, stream, workspaceScope]);

  useEffect(() => {
    if (!activeConvId) return;
    let client;
    try {
      client = getNanobotClient();
    } catch {
      return;
    }
    let cancelled = false;
    const unsubscribe = client.onSessionUpdate((updatedChatId, scope) => {
      if (cancelled || updatedChatId !== activeConvId || scope === 'metadata') return;
      void (async () => {
        try {
          const token = getNanobotToken();
          const base = getGatewayBaseUrl();
          const thread = await fetchWebuiThread(token, conversationIdToSessionKey(activeConvId), base);
          if (cancelled) return;
          setHistoryMessages(projectWebuiThreadMessages(thread?.messages ?? []));
          setHistoryVersion((value) => value + 1);
        } catch {
          // Keep live messages if canonical refresh fails.
        }
      })();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [activeConvId]);


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
      <div className="relative flex-1 min-h-0">
        <div className="h-full overflow-y-auto" ref={containerRef}>
          <div className="w-full max-w-4xl mx-auto px-6 md:px-10 py-8 overflow-hidden">
            <div>
              <ThreadMessages
                messages={displayMessages}
                isStreaming={stream.isStreaming}
                onEditUserMessage={handleEditUserMessage}
                onRegenerateAssistant={handleRegenerateAssistant}
              />

              {/* Thinking indicator - shown after user message but before assistant message appears */}
              {stream.isStreaming && displayMessages.length > 0 && displayMessages.every((m) => m.role === 'user') && (
                <div className="pl-9">
                  <ThinkingIndicator />
                </div>
              )}
            </div>

            {/* Bottom sentinel */}
            <div ref={endRef} className="h-px w-full" />
          </div>
        </div>

        {/* Scroll-to-bottom button */}
        {!isAtBottom && (
          <button
            onClick={scrollToBottom}
            title={t.chat.scrollToBottom}
            aria-label={t.chat.scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center h-8 w-8 rounded-full bg-white/90 border border-[#706b5730] shadow-md text-[#656358] hover:text-[#29261b] hover:bg-white transition-all backdrop-blur-sm"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Bottom Input */}
      <div className="shrink-0 px-6 md:px-10 pb-4 pt-2 bg-gradient-to-t from-[#fbfaf7] via-[#fbfaf7] to-[#fbfaf7]/80">
        <div className="max-w-4xl mx-auto">
          <ActiveSkillsBar />
          <GoalStatusBar goalState={goalState} runStartedAt={runStartedAt} />
          {stream.streamError ? (
            <StreamErrorNotice
              error={stream.streamError}
              canUseFullAccess={workspaceControls?.can_use_full_access ?? true}
              onDismiss={stream.dismissStreamError}
              onAllowFullAccess={handleAllowFullAccessAndRetry}
            />
          ) : null}
          <ChatInput
            variant="chat"
            onSend={handleSend}
            onStop={stream.stop}
            isStreaming={stream.isStreaming}
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
