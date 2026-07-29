import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useChatStore, useActiveConversation } from '@/stores/chatStore';
import type { ImageAttachment, Message } from '@/types';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { useNanobotStream, type SendImage, type SendOptions } from '@/hooks/useNanobotStream';
import {
  getGatewayBaseUrl,
  getNanobotClient,
  getNanobotConnectionStatus,
  getNanobotMcpStatus,
  getNanobotToken,
  mapWebuiThreadToGuiMessages,
  subscribeNanobotConnectionStatus,
  syncSessionsFromGateway,
} from '@/core/nanobotClient';
import type { UIMessage, WorkspaceScopePayload, WorkspacesPayload } from '@/core/types';
import { fetchSessionRuntimeSnapshot, fetchWebuiThread } from '@/core/api';
import { conversationIdToSessionKey } from '@/core/sessionKey';
import { useSettingsStore } from '@/stores/settingsStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { usePromptHubStore } from '@/stores/promptHubStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useToastStore } from '@/stores/toastStore';
import { useConversationWorkbenchStore } from '@/stores/conversationWorkbenchStore';
import { useTurnPlanStore } from '@/stores/turnPlanStore';
import { useI18n } from '@/i18n';
import ThreadMessages from './ThreadMessages';
import InteractivePromptCard, { type InteractivePromptSubmitPayload } from './InteractivePromptCard';
import ChatInput, { type ChatInputSendOptions } from './ChatInput';
import ActiveSkillsBar from './ActiveSkillsBar';
import { ArrowLeft, ChevronDown, Settings } from 'lucide-react';
import { osBridge } from '@/lib/ipc-factory';
import { extractUsername } from '@/utils/pathUtils';
import ThinkingIndicator from './ThinkingIndicator';
import StreamErrorNotice from './StreamErrorNotice';
import { normalizeLegacyLongTaskMessages } from '@/core/nanobot/thread-display-compat';
import { scrubSubagentUiMessages } from '@/core/nanobot/subagent-channel-display';
import { projectUsableSkills, stripUnavailableLeadingSkillMentions } from '@/core/skills/filter';
import { normalizeProjectPath, visibleProjectPath } from '@/core/workspace';
import GenerationStatusBar, { type GenerationPhase } from './GenerationStatusBar';
import { historyHasPendingActivity } from '@/core/nanobot/historyActivity';
import { normalizeTaskTimestamp } from '@/utils/taskDuration';

interface PendingFirstMessage {
  text: string;
  images?: ImageAttachment[];
  options?: ChatInputSendOptions;
  workspaceScope?: WorkspaceScopePayload | null;
}

const HISTORY_PAGE_LIMIT = 200;

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
  workspaceControls,
  workspaceError: _workspaceError,
  onWorkspaceScopeChange: _onWorkspaceScopeChange,
}: {
  workspaceScope?: WorkspaceScopePayload | null;
  workspaceDefaultScope?: WorkspaceScopePayload | null;
  workspaceControls?: WorkspacesPayload['controls'] | null;
  workspaceError?: string | null;
  onWorkspaceScopeChange?: (scope: WorkspaceScopePayload | null) => void;
}) {
  const activeConv = useActiveConversation();
  const activeConvId = activeConv?.id;
  const { createConversation } = useChatStore();
  const scheduleReturnTarget = useScheduleStore((s) => s.returnTarget);
  const setScheduleActiveTaskId = useScheduleStore((s) => s.setActiveTaskId);
  const setScheduleReturnTarget = useScheduleStore((s) => s.setReturnTarget);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const promptHubUsername = usePromptHubStore((s) => s.user?.username);
  const skills = useDiscoveryStore((s) => s.skills);
  const projectSkillBindings = useWorkspaceStore((s) => s.projectSkillBindings);
  const activeProjectPath = visibleProjectPath(workspaceScope?.project_path ?? activeConv?.workspaceScope?.project_path ?? activeConv?.workspacePath);
  const activeProjectSkillNames = activeProjectPath ? projectSkillBindings[normalizeProjectPath(activeProjectPath)] ?? [] : [];
  const availableSkillNames = useMemo(
    () => projectUsableSkills(skills, activeProjectSkillNames).map((skill) => skill.name),
    [activeProjectSkillNames, skills],
  );
  const { t } = useI18n();
  const gatewayConnectionStatus = useSyncExternalStore(
    subscribeNanobotConnectionStatus,
    getNanobotConnectionStatus,
    getNanobotConnectionStatus,
  );
  const gatewayReady = gatewayConnectionStatus === 'open';
  const mcpStatus = useSyncExternalStore(
    subscribeNanobotConnectionStatus,
    getNanobotMcpStatus,
    getNanobotMcpStatus,
  );
  const runtimeNotice = !gatewayReady
    ? t.chat.gatewayStarting
    : mcpStatus === 'pending' || mcpStatus === 'warming'
      ? t.chat.mcpWarming
      : mcpStatus === 'unavailable'
        ? t.chat.mcpUnavailable
        : null;
  const [historyMessages, setHistoryMessages] = useState<UIMessage[]>([]);
  const [historyConversationId, setHistoryConversationId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingOlder, setHistoryLoadingOlder] = useState(false);
  const [historyPage, setHistoryPage] = useState<{
    beforeCursor: string | null;
    hasMoreBefore: boolean;
  }>({ beforeCursor: null, hasMoreBefore: false });
  const [historyVersion, setHistoryVersion] = useState(0);
  const preserveScrollOnHistoryVersionRef = useRef(false);
  const [promptSubmitState, setPromptSubmitState] = useState<{
    promptId: string;
    status: 'submitting' | 'error';
    error?: string;
  } | null>(null);
  const pendingFirstRef = useRef<PendingFirstMessage | null>(null);
  const activeHistoryMessages = historyConversationId === activeConvId
    ? historyMessages
    : [];

  const [greeting, setGreeting] = useState('');
  const [userName, setUserName] = useState('');
  const displayUserName = promptHubUsername?.trim() || userName;

  useEffect(() => {
    if (activeConvId) return;

    const hour = new Date().getHours();
    const isEn = useSettingsStore.getState().language === 'en-US';
    if (hour >= 5 && hour < 12) {
      setGreeting(isEn ? 'Morning' : '早上好');
    } else if (hour >= 12 && hour < 18) {
      setGreeting(isEn ? 'Afternoon' : '下午好');
    } else {
      setGreeting(isEn ? 'Evening' : '晚上好');
    }

    osBridge.homeDir()
      .then((home) => {
        if (home) {
          setUserName(extractUsername(home));
        }
      })
      .catch((err) => console.error('Failed to get home dir:', err));
  }, [activeConvId]);

  const { containerRef, scrollElement, isAtBottom, scrollToBottom } = useAutoScroll();

  const returnToSchedule = useCallback(() => {
    if (scheduleReturnTarget?.taskId) {
      setScheduleActiveTaskId(scheduleReturnTarget.taskId);
    }
    setScheduleReturnTarget(null);
    setViewMode('schedule');
  }, [scheduleReturnTarget, setScheduleActiveTaskId, setScheduleReturnTarget, setViewMode]);

  useEffect(() => {
    if (!activeConvId) {
      setHistoryMessages([]);
      setHistoryConversationId(null);
      setHistoryLoading(false);
      setHistoryLoadingOlder(false);
      setHistoryPage({ beforeCursor: null, hasMoreBefore: false });
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryLoadingOlder(false);
    setHistoryPage({ beforeCursor: null, hasMoreBefore: false });
    (async () => {
      try {
        const token = getNanobotToken();
        const base = getGatewayBaseUrl();
        const sessionKey = conversationIdToSessionKey(activeConvId);
        void fetchSessionRuntimeSnapshot(token, sessionKey, base)
          .then((runtimeSnapshot) => {
            if (cancelled || !runtimeSnapshot) return;
            try {
              getNanobotClient().applyRuntimeSnapshot(activeConvId, runtimeSnapshot);
            } catch {
              // The chat store still receives the authoritative HTTP snapshot
              // when the WebSocket client is not ready yet.
            }
            useChatStore.getState().setConversationRuntimeSnapshot(
              activeConvId,
              runtimeSnapshot,
            );
          })
          .catch(() => {
            // History remains usable when a runtime snapshot is unavailable.
          });
        const thread = await fetchWebuiThread(
          token,
          sessionKey,
          base,
          { limit: HISTORY_PAGE_LIMIT, direction: 'latest' },
        );
        if (cancelled) return;
        const ui = projectWebuiThreadMessages((thread?.messages ?? []).map((message, index) => ({
          ...message,
          id: message.id ?? `hist-${index}`,
          createdAt: typeof message.createdAt === 'number' ? message.createdAt : Date.now(),
        })));
        setHistoryMessages(ui);
        setHistoryConversationId(activeConvId);
        setHistoryPage({
          beforeCursor: thread?.page?.before_cursor ?? null,
          hasMoreBefore: thread?.page?.has_more_before ?? false,
        });
        setHistoryVersion((value) => value + 1);
      } catch {
        if (!cancelled) {
          setHistoryMessages([]);
          setHistoryConversationId(activeConvId);
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

  const loadOlderHistory = useCallback(async () => {
    if (
      !activeConvId
      || historyConversationId !== activeConvId
      || historyLoadingOlder
      || !historyPage.hasMoreBefore
      || !historyPage.beforeCursor
    ) return;
    setHistoryLoadingOlder(true);
    const previousHeight = scrollElement?.scrollHeight ?? 0;
    const previousTop = scrollElement?.scrollTop ?? 0;
    try {
      const thread = await fetchWebuiThread(
        getNanobotToken(),
        conversationIdToSessionKey(activeConvId),
        getGatewayBaseUrl(),
        {
          limit: HISTORY_PAGE_LIMIT,
          before: historyPage.beforeCursor,
        },
      );
      if (useChatStore.getState().activeConversationId !== activeConvId) return;
      const older = projectWebuiThreadMessages((thread?.messages ?? []).map((message, index) => ({
        ...message,
        id: message.id ?? `hist-older-${index}`,
        createdAt: typeof message.createdAt === 'number' ? message.createdAt : Date.now(),
      })));
      preserveScrollOnHistoryVersionRef.current = true;
      setHistoryMessages((current) => {
        const seen = new Set(current.map((message) => message.id));
        return [...older.filter((message) => !seen.has(message.id)), ...current];
      });
      setHistoryPage({
        beforeCursor: thread?.page?.before_cursor ?? null,
        hasMoreBefore: thread?.page?.has_more_before ?? false,
      });
      setHistoryVersion((value) => value + 1);
      window.requestAnimationFrame(() => {
        if (!scrollElement) return;
        scrollElement.scrollTop = previousTop + Math.max(
          0,
          scrollElement.scrollHeight - previousHeight,
        );
      });
    } catch {
      // Keep the currently loaded page when older history cannot be read.
    } finally {
      setHistoryLoadingOlder(false);
    }
  }, [
    activeConvId,
    historyConversationId,
    historyLoadingOlder,
    historyPage.beforeCursor,
    historyPage.hasMoreBefore,
    scrollElement,
  ]);

  const handleTurnEnd = useCallback(() => {
    void syncSessionsFromGateway();
    if (activeConvId) {
      useConversationWorkbenchStore.getState().requestArtifactRefresh(activeConvId);
    }
  }, [activeConvId]);

  const handleArtifactCreated = useCallback(() => {
    if (activeConvId) {
      useConversationWorkbenchStore.getState().requestArtifactRefresh(activeConvId);
    }
  }, [activeConvId]);

  const stream = useNanobotStream(
    activeConvId ?? null,
    activeHistoryMessages,
    historyHasPendingActivity(activeHistoryMessages),
    handleTurnEnd,
    handleArtifactCreated,
  );
  const creatingConversationRef = useRef(false);

  useEffect(() => {
    if (!activeConvId || historyLoading) return;
    stream.setMessages((current) => {
      const projected = projectWebuiThreadMessages(activeHistoryMessages);
      if (projected.length === 0 && current.length > 0) return current;
      return projected;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId, historyConversationId, historyVersion, historyLoading]);

  useEffect(() => {
    if (!activeConvId) return;
    const pending = pendingFirstRef.current;
    if (!pending) return;
    const pendingExpertTeam = pending.options?.expertTeam ?? activeConv?.expertTeam;
    const options: SendOptions = {
      workspaceScope: pending.workspaceScope,
      ...(pendingExpertTeam ? { expertTeam: pendingExpertTeam } : {}),
      ...(pending.options?.cliApps?.length ? { cliApps: pending.options.cliApps } : {}),
      ...(pending.options?.mcpPresets?.length ? { mcpPresets: pending.options.mcpPresets } : {}),
      ...(pending.options?.skillScope ? { skillScope: pending.options.skillScope } : {}),
    };
    if (stream.send(pending.text, imageAttachmentsToSendImages(pending.images), options)) {
      pendingFirstRef.current = null;
    }
  }, [activeConv?.expertTeam, activeConvId, stream]);

  const displayMessages = useMemo(
    () => mapWebuiThreadToGuiMessages(stream.messages),
    [stream.messages],
  );
  const pendingPromptMessage = useMemo(
    () => displayMessages.find((message) => message.interactivePrompt?.status === 'pending') ?? null,
    [displayMessages],
  );
  const timelineMessages = useMemo(
    () => displayMessages.filter((message) => !message.interactivePrompt),
    [displayMessages],
  );
  const latestTurnMessages = useMemo(() => {
    let lastUserIndex = -1;
    for (let index = timelineMessages.length - 1; index >= 0; index -= 1) {
      if (timelineMessages[index].role === 'user') {
        lastUserIndex = index;
        break;
      }
    }
    return lastUserIndex >= 0 ? timelineMessages.slice(lastUserIndex + 1) : timelineMessages;
  }, [timelineMessages]);
  const latestAssistantMessage = useMemo(() => {
    for (let index = latestTurnMessages.length - 1; index >= 0; index -= 1) {
      if (latestTurnMessages[index].role === 'assistant') {
        return latestTurnMessages[index];
      }
    }
    return undefined;
  }, [latestTurnMessages]);
  const runStartedAt = stream.runStartedAt;
  const runtimeActive = activeConv?.runtimeSnapshot?.thread_status.type === 'active';
  const generationActive = stream.isStreaming || runtimeActive;
  const [turnClockNow, setTurnClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (!generationActive) return;
    setTurnClockNow(Date.now());
    const timer = window.setInterval(() => setTurnClockNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [generationActive, runStartedAt]);
  const activeTurnElapsedMs = useMemo(() => {
    if (!generationActive) return undefined;
    const startedAtMs = normalizeTaskTimestamp(runStartedAt);
    return startedAtMs === undefined ? 0 : Math.max(0, turnClockNow - startedAtMs);
  }, [generationActive, runStartedAt, turnClockNow]);
  const generationPhase = useMemo<GenerationPhase | null>(() => {
    if (!generationActive) return null;
    return latestAssistantMessage?.reasoningStreaming ? 'thinking' : 'generating';
  }, [generationActive, latestAssistantMessage?.reasoningStreaming]);
  const generationTokenCount = useMemo(
    () => stream.turnUsage?.newTokens ?? latestTurnMessages.reduce((total, message) => (
      total
      + (message.usage?.inputTokens ?? 0)
      + (message.usage?.outputTokens ?? 0)
    ), 0),
    [latestTurnMessages, stream.turnUsage?.newTokens],
  );
  useEffect(() => {
    if (!activeConvId) return;
    const activeRuntimeTurn = activeConv?.runtimeSnapshot?.active_turn;
    const latestRuntimeTurn = activeConv?.runtimeSnapshot?.latest_turn;
    const selectedRuntimeTurn = activeRuntimeTurn
      ?? (stream.isStreaming ? undefined : latestRuntimeTurn);
    if (selectedRuntimeTurn?.id) {
      useTurnPlanStore.getState().activateTurn(activeConvId, selectedRuntimeTurn.id);
    }
    const runtimePlan = selectedRuntimeTurn?.plan;
    if (runtimePlan) {
      useTurnPlanStore.getState().applyPlan(activeConvId, runtimePlan);
      return;
    }
    if (stream.messageConversationId !== activeConvId) return;
    useTurnPlanStore.getState().hydrateLegacyMessages(
      activeConvId,
      stream.messageConversationId,
      timelineMessages,
      selectedRuntimeTurn?.id ?? activeConvId,
    );
  }, [
    activeConv?.runtimeSnapshot,
    activeConvId,
    stream.isStreaming,
    stream.messageConversationId,
    timelineMessages,
  ]);

  useLayoutEffect(() => {
    if (!activeConvId || historyLoading) return;
    if (preserveScrollOnHistoryVersionRef.current) {
      preserveScrollOnHistoryVersionRef.current = false;
      return;
    }
    scrollToBottom({ force: true, settle: true });
  }, [activeConvId, historyLoading, historyVersion, scrollToBottom]);

  useLayoutEffect(() => {
    if (!activeConvId || historyLoading) return;
    scrollToBottom({ force: false });
  }, [activeConvId, historyLoading, stream.isStreaming, timelineMessages, scrollToBottom]);

  const handleSend = (
    text: string,
    images?: ImageAttachment[],
    welcomeWorkspacePath?: string | null,
    options?: ChatInputSendOptions,
  ) => {
    if (!gatewayReady) return false;
    // Block sending if API key is not configured
    const currentApiKey = useSettingsStore.getState().apiKey;
    if (!currentApiKey?.trim()) {
      useSettingsStore.getState().openSystemSettings('ai-services');
      return false;
    }

    // Use gateway-provided scope; fall back to welcome path if provided
    let effectiveScope: WorkspaceScopePayload | null = workspaceScope ?? null;
    if (!effectiveScope && welcomeWorkspacePath) {
      const parts = welcomeWorkspacePath.split('/').filter(Boolean);
      effectiveScope = {
        project_path: welcomeWorkspacePath,
        project_name: parts[parts.length - 1] || welcomeWorkspacePath,
        access_mode: 'full',
        restrict_to_workspace: false,
      };
    }

    const sendOptions: ChatInputSendOptions = {
      ...(options?.cliApps?.length ? { cliApps: options.cliApps } : {}),
      ...(options?.mcpPresets?.length ? { mcpPresets: options.mcpPresets } : {}),
      ...(options?.skillScope ? { skillScope: options.skillScope } : {}),
      ...(options?.expertTeam ? { expertTeam: options.expertTeam } : {}),
    };
    const effectiveExpertTeam = sendOptions.expertTeam ?? activeConv?.expertTeam;
    const wireOptions: SendOptions = {
      workspaceScope: effectiveScope,
      ...(effectiveExpertTeam ? { expertTeam: effectiveExpertTeam } : {}),
      ...(sendOptions.cliApps?.length ? { cliApps: sendOptions.cliApps } : {}),
      ...(sendOptions.mcpPresets?.length ? { mcpPresets: sendOptions.mcpPresets } : {}),
      ...(sendOptions.skillScope ? { skillScope: sendOptions.skillScope } : {}),
    };

    const convId = activeConv?.id;
    if (!convId) {
      if (creatingConversationRef.current) return false;
      pendingFirstRef.current = {
        text,
        images,
        options: sendOptions,
        workspaceScope: effectiveScope,
      };
      creatingConversationRef.current = true;
      void Promise.resolve()
        .then(() => getNanobotClient().newChat(5_000, effectiveScope, sendOptions.expertTeam))
        .then((gatewayChatId) => {
          createConversation(welcomeWorkspacePath ?? effectiveScope?.project_path ?? null, {
            id: gatewayChatId,
            workspaceScope: effectiveScope,
            title: text.slice(0, 30) + (text.length > 30 ? '...' : ''),
            expertTeam: sendOptions.expertTeam ?? null,
          });
        })
        .catch((error) => {
          pendingFirstRef.current = null;
          useChatStore.getState().setPendingInput(text);
          useToastStore.getState().addToast({
            type: 'error',
            title: '新建会话失败',
            message: error instanceof Error ? error.message : String(error),
            duration: 5000,
          });
        })
        .finally(() => {
          creatingConversationRef.current = false;
        });
    } else {
      if (!stream.send(text, imageAttachmentsToSendImages(images), wireOptions)) {
        return false;
      }
    }
    scrollToBottom({ force: true });
    return true;
  };

  const resendFromUserMessage = useCallback((
    userMessage: UIMessage,
    content: string,
    overrideWorkspaceScope?: WorkspaceScopePayload | null,
  ) => {
    const sendImages = sendImagesFromUiMessage(userMessage);
    const effectiveScope = overrideWorkspaceScope ?? workspaceScope;
    const options: SendOptions = {
      workspaceScope: effectiveScope,
      ...(activeConv?.expertTeam ? { expertTeam: activeConv.expertTeam } : {}),
      ...(userMessage.cliApps?.length ? { cliApps: userMessage.cliApps } : {}),
      ...(userMessage.mcpPresets?.length ? { mcpPresets: userMessage.mcpPresets } : {}),
    };
    stream.setMessages((current) => {
      const index = current.findIndex((message) => message.id === userMessage.id);
      if (index < 0) return current;
      return current.slice(0, index);
    });
    stream.send(stripUnavailableLeadingSkillMentions(content, availableSkillNames), sendImages, options);
    scrollToBottom({ force: true });
  }, [activeConv?.expertTeam, availableSkillNames, scrollToBottom, stream, workspaceScope]);

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

  const handleSubmitInteractivePromptAnswer = useCallback((
    message: Message,
    payload: InteractivePromptSubmitPayload,
  ) => {
    const prompt = message.interactivePrompt;
    if (!prompt || prompt.status !== 'pending') return;
    setPromptSubmitState({ promptId: prompt.promptId, status: 'submitting' });
    try {
      stream.send(payload.text, undefined, {
        workspaceScope,
        ...(activeConv?.expertTeam ? { expertTeam: activeConv.expertTeam } : {}),
        interactivePromptAnswer: payload.answer,
      });
      stream.setMessages((current) => current.map((item) => {
        if (item.id !== message.id || item.role !== 'assistant' || !item.interactivePrompt) return item;
        return {
          ...item,
          interactivePrompt: {
            ...item.interactivePrompt,
            status: payload.answer.answerType === 'skip' ? 'skipped' : 'answered',
            answeredOptionId: payload.answer.optionId,
            answeredText: payload.answeredText,
          },
        };
      }));
      scrollToBottom({ force: true });
    } catch {
      setPromptSubmitState({
        promptId: prompt.promptId,
        status: 'error',
        error: '提交失败，请重试',
      });
    }
  }, [activeConv?.expertTeam, scrollToBottom, stream, workspaceScope]);

  useEffect(() => {
    if (!promptSubmitState) return;
    const prompt = pendingPromptMessage?.interactivePrompt;
    if (!prompt || prompt.promptId !== promptSubmitState.promptId) {
      setPromptSubmitState(null);
    }
  }, [pendingPromptMessage, promptSubmitState]);

  useEffect(() => {
    if (!promptSubmitState || promptSubmitState.status !== 'submitting' || !stream.streamError) return;
    setPromptSubmitState({
      promptId: promptSubmitState.promptId,
      status: 'error',
      error: '提交失败，请重试',
    });
  }, [promptSubmitState, stream.streamError]);

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
          const thread = await fetchWebuiThread(
            token,
            conversationIdToSessionKey(activeConvId),
            base,
            { limit: HISTORY_PAGE_LIMIT, direction: 'latest' },
          );
          if (cancelled) return;
          setHistoryMessages(projectWebuiThreadMessages(thread?.messages ?? []));
          setHistoryConversationId(activeConvId);
          setHistoryPage({
            beforeCursor: thread?.page?.before_cursor ?? null,
            hasMoreBefore: thread?.page?.has_more_before ?? false,
          });
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
  const welcomeProjectName = workspaceScope?.project_name || workspaceScope?.project_path?.split(/[\\/]/).filter(Boolean).pop();

  if (!activeConv) {
    return (
      <div className="flex flex-col h-full bg-[#fbfaf7]">
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-12">
          <div className="w-full max-w-3xl">
            {/* Title */}
            <div className="text-center mb-8">
              {/* Slogan */}
              <h1 className="text-[28px] text-[#29261b] leading-tight mb-3 flex items-center justify-center gap-3.5 font-claude-response font-medium select-none">
                {welcomeProjectName ? (
                  <span>
                    {useSettingsStore.getState().language === 'en-US'
                      ? `What should we build in ${welcomeProjectName}?`
                      : `我们应该在 ${welcomeProjectName} 中构建什么？`}
                  </span>
                ) : (
                  <span>
                    {greeting}
                    {displayUserName ? (
                      useSettingsStore.getState().language === 'en-US' ? `, ${displayUserName}` : `，${displayUserName}`
                    ) : ''}
                    {useSettingsStore.getState().language === 'en-US' ? '. ' : '，'}
                    {t.chat.welcomeTitle}
                  </span>
                )}
              </h1>
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
                sendDisabled={!gatewayReady}
                workspaceScope={workspaceScope}
                onWorkspaceScopeChange={_onWorkspaceScopeChange}
              />
              {runtimeNotice ? (
                <p className="mt-2 text-center text-[12px] text-amber-700">
                  {runtimeNotice}
                </p>
              ) : null}
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
        <div
          key={activeConvId}
          className="h-full overflow-y-auto"
          ref={containerRef}
        >
          <div className="w-full max-w-4xl mx-auto px-6 md:px-10 py-8 overflow-hidden">
            <div>
              {historyPage.hasMoreBefore ? (
                <div className="mb-5 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadOlderHistory()}
                    disabled={historyLoadingOlder}
                    className="rounded-full border border-[#d8d5ce] bg-white/80 px-3 py-1.5 text-[12px] text-[#656358] transition-colors hover:bg-white hover:text-[#29261b] disabled:opacity-50"
                  >
                    {historyLoadingOlder
                      ? (useSettingsStore.getState().language === 'en-US' ? 'Loading…' : '正在加载…')
                      : (useSettingsStore.getState().language === 'en-US' ? 'Load earlier messages' : '加载更早消息')}
                  </button>
                </div>
              ) : null}
              <ThreadMessages
                messages={timelineMessages}
                isStreaming={stream.isStreaming}
                activeTurnElapsedMs={activeTurnElapsedMs}
                scrollElement={scrollElement}
                onEditUserMessage={handleEditUserMessage}
                onRegenerateAssistant={handleRegenerateAssistant}
              />

              {/* Thinking indicator - shown after user message but before assistant message appears */}
              {stream.isStreaming && timelineMessages.length > 0 && timelineMessages.every((m) => m.role === 'user') && (
                <div className="pl-9">
                  <ThinkingIndicator />
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Scroll-to-bottom button */}
        {!isAtBottom && (
          <button
            onClick={() => scrollToBottom({ force: true })}
            title={t.chat.scrollToBottom}
            aria-label={t.chat.scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center h-8 w-8 rounded-full bg-white/90 border border-[#706b5730] shadow-md text-[#656358] hover:text-[#29261b] hover:bg-white transition-all backdrop-blur-sm"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Bottom Input */}
      <div className="shrink-0 bg-gradient-to-t from-[#fbfaf7] via-[#fbfaf7]/95 to-transparent px-6 pb-4 pt-2 md:px-10">
        <div className="max-w-4xl mx-auto">
          <ActiveSkillsBar />
          {scheduleReturnTarget && (
            <button
              onClick={returnToSchedule}
              className="mb-2 inline-flex items-center gap-1.5 rounded-lg border border-[#e5e2db] bg-white/85 px-3 py-1.5 text-[12.5px] font-medium text-[#656358] shadow-sm hover:bg-white hover:text-[#29261b]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回定时任务
            </button>
          )}
          {generationPhase ? (
            <GenerationStatusBar
              phase={generationPhase}
              startedAt={runStartedAt}
              elapsedMs={activeTurnElapsedMs}
              tokenCount={generationTokenCount}
              tokenCountEstimated={stream.turnUsage?.estimated ?? false}
            />
          ) : null}
          {stream.streamError ? (
            <StreamErrorNotice
              error={stream.streamError}
              canUseFullAccess={workspaceControls?.can_use_full_access ?? true}
              onDismiss={stream.dismissStreamError}
              onAllowFullAccess={handleAllowFullAccessAndRetry}
            />
          ) : null}
          {pendingPromptMessage?.interactivePrompt ? (
            <div className="mb-3">
              <InteractivePromptCard
                prompt={pendingPromptMessage.interactivePrompt}
                compact
                submitting={
                  promptSubmitState?.promptId === pendingPromptMessage.interactivePrompt.promptId
                  && promptSubmitState.status === 'submitting'
                }
                error={
                  promptSubmitState?.promptId === pendingPromptMessage.interactivePrompt.promptId
                    && promptSubmitState.status === 'error'
                    ? promptSubmitState.error ?? '提交失败，请重试'
                    : null
                }
                onSubmit={(payload) => handleSubmitInteractivePromptAnswer(pendingPromptMessage, payload)}
              />
            </div>
          ) : null}
          <ChatInput
            variant="chat"
            onSend={handleSend}
            onStop={stream.stop}
            isStreaming={stream.isStreaming}
            disabled={!!pendingPromptMessage}
            sendDisabled={!gatewayReady}
            workspaceScope={workspaceScope}
            onWorkspaceScopeChange={_onWorkspaceScopeChange}
          />
          {runtimeNotice ? (
            <p className="mt-2 text-center text-[12px] text-amber-700">
              {runtimeNotice}
            </p>
          ) : null}
          <p className="text-center text-[13px] text-[#8a867c] mt-3">
            {t.chat.disclaimer}
          </p>
        </div>
      </div>
    </div>
  );
}
