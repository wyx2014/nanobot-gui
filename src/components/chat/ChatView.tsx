import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useChatStore, useActiveConversation } from '@/stores/chatStore';
import type { ImageAttachment, Message } from '@/types';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { useNanobotStream, type SendImage, type SendOptions } from '@/hooks/useNanobotStream';
import {
  getGatewayBaseUrl,
  getNanobotClient,
  getNanobotConnectionStatus,
  getNanobotToken,
  mapWebuiThreadToGuiMessages,
  subscribeNanobotConnectionStatus,
  syncSessionsFromGateway,
} from '@/core/nanobotClient';
import type { UIMessage, WorkspaceScopePayload, WorkspacesPayload } from '@/core/types';
import {
  THREAD_HISTORY_MESSAGE_LIMIT,
} from '@/core/api';
import { conversationIdToSessionKey } from '@/core/sessionKey';
import { projectThreadResource } from '@/core/nanobot/threadResourceProjection';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useBrowserStore } from '@/stores/browserStore';
import {
  getConversationColumnClasses,
  PINNED_SUMMARY_CONTENT_INSET,
  PINNED_SUMMARY_CONTENT_MAX_WIDTH,
} from '@/components/panel/layout';
import { usePromptHubStore } from '@/stores/promptHubStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useToastStore } from '@/stores/toastStore';
import { useConversationWorkbenchStore } from '@/stores/conversationWorkbenchStore';
import { useTurnPlanStore } from '@/stores/turnPlanStore';
import { useThreadResourceStore } from '@/stores/threadResourceStore';
import { useI18n } from '@/i18n';
import ThreadMessages from './ThreadMessages';
import InteractivePromptCard, { type InteractivePromptSubmitPayload } from './InteractivePromptCard';
import ChatInput, { type ChatInputSendOptions } from './ChatInput';
import ActiveSkillsBar from './ActiveSkillsBar';
import { ChevronDown, Settings } from 'lucide-react';
import { osBridge } from '@/lib/ipc-factory';
import { extractUsername } from '@/utils/pathUtils';
import StreamErrorNotice from './StreamErrorNotice';
import { normalizeLegacyLongTaskMessages } from '@/core/nanobot/thread-display-compat';
import { scrubSubagentUiMessages } from '@/core/nanobot/subagent-channel-display';
import { projectUsableSkills, stripUnavailableLeadingSkillMentions } from '@/core/skills/filter';
import { normalizeProjectPath, projectNameFromPath, visibleProjectPath } from '@/core/workspace';
import {
  projectLegacyLocalFileContext,
  replaceVisibleLocalFileContent,
} from '@/core/nanobot/localFileContext';
import GenerationStatusBar, { type GenerationPhase } from './GenerationStatusBar';
import ThinkingOrb from '@/components/common/ModalAwareThinkingOrb';
import ConversationHeader from './ConversationHeader';
import { historyHasPendingActivity } from '@/core/nanobot/historyActivity';
import { buildTaskNarrativeEntries } from '@/core/nanobot/taskNarrativeTimeline';
import { preserveLatestUserAnchor } from '@/core/nanobot/threadHistoryMerge';
import { loadConversationHistory } from '@/core/nanobot/conversationHistory';
import { normalizeTaskTimestamp } from '@/utils/taskDuration';
import { cn } from '@/lib/utils';
import { isMacOS } from '@/utils/platform';
import { useConversationSearch } from './useConversationSearch';
import { shouldShowConversationLoading } from './conversationHistoryLoading';

interface PendingFirstMessage {
  text: string;
  images?: ImageAttachment[];
  options?: ChatInputSendOptions;
  workspaceScope?: WorkspaceScopePayload | null;
}

const HISTORY_PAGE_LIMIT = THREAD_HISTORY_MESSAGE_LIMIT;

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
  const scheduledTaskId = activeConv?.scheduledTaskId;
  // Ordinary chat status changes (idle -> running -> completed) must not
  // refetch the transcript. Scheduled runs are the only flow whose status can
  // make an initially empty history become available later.
  const scheduledHistoryStatus = scheduledTaskId ? activeConv?.status : undefined;
  const summaryCollapsed = useSettingsStore((s) => s.rightPanelCollapsed);
  // The summary inset must match what RightPanel actually renders: it only
  // floats the summary card when no artifact preview / browser panel is open.
  // Otherwise opening an artifact while the summary toggle is still on would
  // squeeze the conversation by the phantom summary inset PLUS the panel.
  const previewArtifact = usePreviewStore((s) => s.previewArtifact);
  const browserOpen = useBrowserStore((s) => (
    activeConvId ? s.sessions[activeConvId]?.open === true : false
  ));
  const summaryContentInset = activeConvId && !summaryCollapsed && !previewArtifact && !browserOpen
    ? PINNED_SUMMARY_CONTENT_INSET
    : 0;
  const conversationColumnClasses = getConversationColumnClasses(summaryContentInset > 0);
  const { createConversation } = useChatStore();
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


  const [historyMessages, setHistoryMessages] = useState<UIMessage[]>([]);
  const [historyConversationId, setHistoryConversationId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const [historyReloadRevision, setHistoryReloadRevision] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [conversationSearchQuery, setConversationSearchQuery] = useState('');
  const [promptSubmitState, setPromptSubmitState] = useState<{
    promptId: string;
    status: 'submitting' | 'error';
    error?: string;
  } | null>(null);
  const pendingFirstRef = useRef<PendingFirstMessage | null>(null);
  const activeHistoryMessages = historyConversationId === activeConvId
    ? historyMessages
    : [];
  const isConversationLoading = shouldShowConversationLoading(
    activeConvId,
    historyConversationId,
  );
  const canonicalThreadResource = useThreadResourceStore((state) => (
    activeConvId
      ? state.resourcesBySession[conversationIdToSessionKey(activeConvId)]
      : undefined
  ));
  const hasCanonicalThreadResource = Boolean(canonicalThreadResource);

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
  const chatSurfaceRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const composerDockHeightRef = useRef(0);

  useLayoutEffect(() => {
    const dock = composerDockRef.current;
    if (!activeConvId || !dock) {
      composerDockHeightRef.current = 0;
      chatSurfaceRef.current?.style.removeProperty('--chat-composer-dock-height');
      return;
    }

    const measure = () => {
      const nextHeight = Math.ceil(dock.getBoundingClientRect().height);
      if (composerDockHeightRef.current === nextHeight) return;
      composerDockHeightRef.current = nextHeight;
      chatSurfaceRef.current?.style.setProperty('--chat-composer-dock-height', `${nextHeight}px`);
      // The dock can grow substantially when an interactive prompt appears.
      // Keep the user's bottom anchor without scheduling a full ChatView render.
      scrollToBottom({ force: false });
    };
    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [activeConvId, scrollToBottom]);

  useEffect(() => {
    if (!activeConvId) {
      setHistoryMessages([]);
      setHistoryConversationId(null);
      setHistoryLoading(false);
      setHistoryLoadFailed(false);
      return;
    }
    if (!gatewayReady) {
      // Persisted conversation metadata is already safe to show in the
      // sidebar. Wait for authenticated HTTP/WS state before hydrating its
      // transcript so a normal cold start never becomes a false load error.
      setHistoryLoading(true);
      setHistoryLoadFailed(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryLoadFailed(false);
    (async () => {
      try {
        const token = getNanobotToken();
        const base = getGatewayBaseUrl();
        const sessionKey = conversationIdToSessionKey(activeConvId);
        const history = await loadConversationHistory(
          token,
          sessionKey,
          base,
          HISTORY_PAGE_LIMIT,
        );
        if (cancelled) return;
        if (history.resource) {
          const runtimeSnapshot = projectThreadResource(activeConvId, history.resource);
          if (runtimeSnapshot) {
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
          }
        } else if (history.runtimeSnapshot) {
          const runtimeSnapshot = history.runtimeSnapshot;
          if (runtimeSnapshot) {
            try {
              getNanobotClient().applyRuntimeSnapshot(activeConvId, runtimeSnapshot);
            } catch {
              // Compatibility store update below remains sufficient.
            }
            useChatStore.getState().setConversationRuntimeSnapshot(activeConvId, runtimeSnapshot);
          }
        }
        const ui = projectWebuiThreadMessages(history.messages.map((message, index) => ({
          ...message,
          id: message.id ?? `hist-${index}`,
          createdAt: typeof message.createdAt === 'number' ? message.createdAt : Date.now(),
        })));
        setHistoryMessages(ui);
        setHistoryConversationId(activeConvId);
        setHistoryVersion((value) => value + 1);
      } catch (error) {
        if (!cancelled) {
          const waitingForScheduledRun = scheduledTaskId
            && scheduledHistoryStatus === 'running';
          if (!waitingForScheduledRun) {
            console.error('[ChatView] Failed to load conversation history:', error);
          }
          setHistoryMessages([]);
          setHistoryConversationId(activeConvId);
          setHistoryLoadFailed(!waitingForScheduledRun);
          setHistoryVersion((value) => value + 1);
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeConvId, gatewayReady, historyReloadRevision, scheduledHistoryStatus, scheduledTaskId]);

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

  // The live stream is an optimistic overlay; a freshly fetched Thread
  // Resource is the durable transcript authority. Global terminal refreshes
  // replace the resource's message array, so immediately project that array
  // back into the chat instead of waiting for a conversation switch.
  useEffect(() => {
    if (!activeConvId || !canonicalThreadResource?.messages) return;
    setHistoryMessages((current) => preserveLatestUserAnchor(
      current,
      projectWebuiThreadMessages(canonicalThreadResource.messages),
      canonicalThreadResource.message_page,
    ));
    setHistoryConversationId(activeConvId);
    setHistoryLoadFailed(false);
    setHistoryVersion((value) => value + 1);
  }, [
    activeConvId,
    canonicalThreadResource?.message_page,
    canonicalThreadResource?.messages,
  ]);

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

  const pendingPromptMessage = useMemo(
    () => stream.messages.find((message) => message.interactivePrompt?.status === 'pending') ?? null,
    [stream.messages],
  );
  const timelineSourceRef = useRef<UIMessage[]>([]);
  const timelineSourceMessages = useMemo(() => {
    const next = stream.messages.filter((message) => !message.interactivePrompt);
    const previous = timelineSourceRef.current;
    if (
      previous.length === next.length
      && previous.every((message, index) => message === next[index])
    ) {
      return previous;
    }
    timelineSourceRef.current = next;
    return next;
  }, [stream.messages]);
  const timelineMessages = useMemo(
    () => mapWebuiThreadToGuiMessages(timelineSourceMessages),
    [timelineSourceMessages],
  );
  const conversationSearch = useConversationSearch({
    root: scrollElement,
    open: conversationSearchOpen,
    query: conversationSearchQuery,
    contentRevision: timelineMessages,
  });
  const openConversationSearch = useCallback(() => {
    setConversationSearchOpen(true);
  }, []);
  const closeConversationSearch = useCallback(() => {
    setConversationSearchOpen(false);
    setConversationSearchQuery('');
  }, []);

  useEffect(() => {
    setConversationSearchOpen(false);
    setConversationSearchQuery('');
  }, [activeConvId]);
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
  const generationActive = hasCanonicalThreadResource
    ? runtimeActive
    : stream.isStreaming || runtimeActive;
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
    if (latestAssistantMessage?.reasoningStreaming) return 'thinking';
    const runningTools = buildTaskNarrativeEntries(latestTurnMessages)
      .filter((entry) => entry.status === 'running' && entry.kind !== 'analysis' && entry.kind !== 'narration');
    if (runningTools.length > 0) {
      return runningTools.some((entry) => entry.source === 'web') ? 'searching' : 'working';
    }
    return 'generating';
  }, [generationActive, latestAssistantMessage?.reasoningStreaming, latestTurnMessages]);
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
    if (hasCanonicalThreadResource || stream.messageConversationId !== activeConvId) return;
    useTurnPlanStore.getState().hydrateLegacyMessages(
      activeConvId,
      stream.messageConversationId,
      timelineMessages,
      selectedRuntimeTurn?.id ?? activeConvId,
    );
  }, [
    activeConv?.runtimeSnapshot,
    activeConvId,
    hasCanonicalThreadResource,
    stream.isStreaming,
    stream.messageConversationId,
    timelineMessages,
  ]);

  useLayoutEffect(() => {
    if (!activeConvId || historyLoading) return;
    scrollToBottom({ force: true });
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
      effectiveScope = {
        project_path: welcomeWorkspacePath,
        project_name: projectNameFromPath(welcomeWorkspacePath),
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
      const localFileContext = projectLegacyLocalFileContext(text);
      const titleSource = localFileContext.visibleContent.trim()
        || localFileContext.files.map((file) => file.name).join(', ')
        || text;
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
            title: titleSource.slice(0, 30) + (titleSource.length > 30 ? '...' : ''),
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
    resendFromUserMessage(
      userMessage,
      replaceVisibleLocalFileContent(userMessage.content, trimmed),
    );
  }, [resendFromUserMessage, stream.messages]);

  const handleSubmitInteractivePromptAnswer = useCallback((
    message: UIMessage,
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

  const handlePendingPromptSubmit = useCallback((payload: InteractivePromptSubmitPayload) => {
    if (!pendingPromptMessage) return;
    handleSubmitInteractivePromptAnswer(pendingPromptMessage, payload);
  }, [handleSubmitInteractivePromptAnswer, pendingPromptMessage]);

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
          const history = await loadConversationHistory(
            token,
            conversationIdToSessionKey(activeConvId),
            base,
            HISTORY_PAGE_LIMIT,
          );
          if (cancelled) return;
          if (history.resource) {
            const runtimeSnapshot = projectThreadResource(activeConvId, history.resource);
            if (runtimeSnapshot) {
              try {
                getNanobotClient().applyRuntimeSnapshot(activeConvId, runtimeSnapshot);
              } catch {
                // Store projection below is enough while socket reconnects.
              }
              useChatStore.getState().setConversationRuntimeSnapshot(activeConvId, runtimeSnapshot);
            }
            setHistoryMessages((current) => preserveLatestUserAnchor(
              current,
              projectWebuiThreadMessages(history.messages),
              history.resource?.message_page,
            ));
          } else {
            if (history.runtimeSnapshot) {
              try {
                getNanobotClient().applyRuntimeSnapshot(
                  activeConvId,
                  history.runtimeSnapshot,
                );
              } catch {
                // The durable fallback transcript is still usable on its own.
              }
              useChatStore.getState().setConversationRuntimeSnapshot(
                activeConvId,
                history.runtimeSnapshot,
              );
            }
            setHistoryMessages(projectWebuiThreadMessages(history.messages));
          }
          setHistoryConversationId(activeConvId);
          setHistoryLoadFailed(false);
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
  const welcomeProjectName = workspaceScope?.project_name
    || (workspaceScope?.project_path ? projectNameFromPath(workspaceScope.project_path) : undefined);

  // Keep the application shell visible while the local runtime starts, and
  // use the chat surface itself for a calm, contextual readiness indicator.
  if (!gatewayReady) {
    return (
      <div data-chat-surface className="flex h-full min-h-[45vh] w-full items-center justify-center bg-[#fbfaf7] dark:bg-[#1f1f1f]">
        <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
          <ThinkingOrb state="solving" size={64} style={{ width: 44, height: 44 }} aria-label="" />
          <p className="text-[15px] font-medium leading-6 text-[#88857b] dark:text-[#aaa69e]">
            {t.chat.gatewayStarting}
          </p>
        </div>
      </div>
    );
  }

  if (!activeConv) {
    return (
      <div data-chat-surface className="flex h-full flex-col bg-[#fbfaf7]">
        <div className="flex flex-1 flex-col items-center justify-center px-8 py-10">
          <div className="w-full max-w-[720px] -translate-y-[2vh]">
            {/* Title */}
            <div className="mb-6 text-center">
              {/* Slogan */}
              <h1 className="flex items-center justify-center gap-3.5 font-claude-response text-[27px] font-medium leading-[1.25] text-[#29261b] select-none">
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

            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={chatSurfaceRef}
      data-chat-surface
      className={cn(
        'relative flex min-h-0 min-w-0 flex-col bg-[#fbfaf7] dark:bg-[#1f1f1f]',
        isMacOS() ? '-mt-12 h-[calc(100%+3rem)]' : 'h-full',
      )}
    >
      <ConversationHeader
        conversationTitle={activeConv.title}
        onOpenTerminal={() => osBridge.openTerminal(activeProjectPath ?? undefined)}
        searchOpen={conversationSearchOpen}
        searchQuery={conversationSearchQuery}
        searchMatchCount={conversationSearch.matchCount}
        activeSearchMatchIndex={conversationSearch.activeMatchIndex}
        onOpenSearch={openConversationSearch}
        onCloseSearch={closeConversationSearch}
        onSearchQueryChange={setConversationSearchQuery}
        onPreviousSearchMatch={conversationSearch.selectPrevious}
        onNextSearchMatch={conversationSearch.selectNext}
      />

      {/* Messages Area */}
      <div className="relative flex-1 min-h-0">
        <div
          key={activeConvId}
          data-conversation-scroll-container
          className="conversation-detail-scrollbar conversation-search-scope h-full overflow-y-auto"
          ref={containerRef}
          style={summaryContentInset ? { paddingRight: summaryContentInset } : undefined}
          aria-busy={isConversationLoading}
        >
          <div className={cn(
            'py-8 overflow-hidden px-6 md:px-10',
            conversationColumnClasses.outer,
            // Keep the same full reading measure when the summary opens. On a
            // compact Windows viewport App temporarily reclaims the navigation
            // sidebar width, so this column no longer has to collapse to 3xl.
          )}>
            <div>
              {isConversationLoading ? (
                <div
                  data-testid="conversation-loading"
                  className="flex min-h-[45vh] items-center justify-center"
                  role="status"
                  aria-live="polite"
                >
                  <div className="inline-flex items-center gap-2.5 text-[13px] text-[#88857b] dark:text-[#aaa69e]">
                    <ThinkingOrb state="solving" size={64} style={{ width: 32, height: 32 }} aria-label="" />
                    <span>{t.chat.loadingConversation}</span>
                  </div>
                </div>
              ) : (
                <>
                  {historyLoadFailed ? (
                    <div
                      className="flex min-h-[45vh] flex-col items-center justify-center gap-3 text-center"
                      role="alert"
                    >
                      <p className="text-[14px] font-medium text-[#4d4a42] dark:text-[#d8d4cc]">
                        {t.chat.conversationLoadFailed}
                      </p>
                      <p className="max-w-md text-[12.5px] text-[#88857b] dark:text-[#aaa69e]">
                        {t.chat.conversationLoadFailedDesc}
                      </p>
                      <button
                        type="button"
                        onClick={() => setHistoryReloadRevision((value) => value + 1)}
                        className="rounded-lg border border-[#d8d4ca] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4d4a42] shadow-sm hover:bg-[#f5f3ee] dark:border-white/15 dark:bg-[#2b2b2b] dark:text-[#e7e2d9] dark:hover:bg-[#363636]"
                      >
                        {t.task.retryAction}
                      </button>
                    </div>
                  ) : (
                    <ThreadMessages
                      messages={timelineMessages}
                      isStreaming={stream.isStreaming}
                      activeTurnElapsedMs={activeTurnElapsedMs}
                      latestTurnStatus={
                        !stream.isStreaming && !activeConv.runtimeSnapshot?.active_turn
                          ? activeConv.runtimeSnapshot?.latest_turn?.status
                          : undefined
                      }
                      onEditUserMessage={handleEditUserMessage}
                    />
                  )}
                </>
              )}
            </div>

            <div
              aria-hidden="true"
              data-chat-composer-spacer
              style={{ height: 'var(--chat-composer-dock-height, 0px)' }}
            />

          </div>
        </div>

        {/* Scroll-to-bottom button */}
        {!isConversationLoading && !isAtBottom && (
          <button
            onClick={() => scrollToBottom({ force: true })}
            title={t.chat.scrollToBottom}
            aria-label={t.chat.scrollToBottom}
            style={{
              bottom: 'calc(var(--chat-composer-dock-height, 0px) + 12px)',
              left: summaryContentInset
                // Center on the shared outer conversation column (right-aligned
                // max-w-4xl with the summary inset), never over the summary.
                // The compact composer is centered inside this same column.
                // min() keeps the center correct when the window is too narrow
                // for the full 896px column.
                ? `calc(100% - ${PINNED_SUMMARY_CONTENT_INSET}px - min(${PINNED_SUMMARY_CONTENT_MAX_WIDTH}px, calc(100% - ${PINNED_SUMMARY_CONTENT_INSET}px)) / 2)`
                : '50%',
              transform: 'translateX(-50%)',
            }}
            className="absolute z-10 flex h-8 w-8 items-center justify-center rounded-full border border-[#706b5730] bg-white/90 text-[#656358] shadow-md backdrop-blur-sm transition-all hover:bg-white hover:text-[#29261b] dark:border-white/15 dark:bg-[#2b2b2b]/95 dark:text-[#d9d5cd] dark:shadow-[0_4px_16px_rgba(0,0,0,0.45)] dark:hover:bg-[#3a3a3a] dark:hover:text-white"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Bottom Input */}
      <div
        ref={composerDockRef}
        data-chat-composer-dock
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-transparent pb-4 pt-2',
          // Summary open: drop the dock's horizontal padding so the composer
          // column shares the exact same box as the message content above.
          summaryContentInset ? 'px-0' : 'px-6 md:px-10',
        )}
        style={summaryContentInset ? { paddingRight: summaryContentInset } : undefined}
      >
        <div className={cn(
          'pointer-events-auto',
          conversationColumnClasses.outer,
        )}>
          <div
            data-chat-composer-column
            className={conversationColumnClasses.composer}
          >
            <ActiveSkillsBar />
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
                  key={pendingPromptMessage.interactivePrompt.promptId}
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
                  onSubmit={handlePendingPromptSubmit}
                />
              </div>
            ) : null}
            <ChatInput
              variant="chat"
              onSend={handleSend}
              onStop={stream.stop}
              isStreaming={stream.isStreaming}
              isStopping={stream.isStopping}
              disabled={!!pendingPromptMessage}
              sendDisabled={!gatewayReady}
              workspaceScope={workspaceScope}
              onWorkspaceScopeChange={_onWorkspaceScopeChange}
            />
          </div>

        </div>
      </div>
    </div>
  );
}
