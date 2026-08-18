import { lazy, Suspense, useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, type CSSProperties } from 'react';
import { ipc, windowBridge, eventBridge } from '@/lib/ipc-factory';
import Sidebar from '@/components/sidebar/Sidebar';
import ToastContainer from '@/components/common/ToastContainer';
import AppTitlebarMenu from '@/components/common/AppTitlebarMenu';
import { useToastStore } from '@/stores/toastStore';
import { initPlatform } from '@/utils/platform';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { initNetworkProxy } from '@/core/sandbox/config';
import type { WorkspaceScopePayload, WorkspacesPayload } from '@/core/types';
import { fetchWorkspaces, updateNetworkSafetySettings } from '@/core/api';
import { getNanobotClient, getNanobotConnectionStatus, getNanobotToken, getNanobotStatus } from '@/core/nanobotClient';
import { projectNameFromPath } from '@/core/workspace';
import { useChatStore } from '@/stores/chatStore';
import { useScheduleStore } from '@/stores/scheduleStore';

// Initialize platform detection at module load time (before any component renders)
// so that isWindows()/isMacOS() return correct values immediately
initPlatform().then(() => {
  // Start network proxy after platform is detected (needs isMacOS())
  initNetworkProxy().catch((err) => {
    console.warn('[App] Network proxy init error:', err);
  });
}).catch((err) => {
  console.warn('[App] Platform detection init error:', err);
});
import { useSettingsStore, getEffectiveModel } from '@/stores/settingsStore';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ArrowLeft, ArrowRight, PanelLeft } from 'lucide-react';
import ThinkingOrb from '@/components/common/ModalAwareThinkingOrb';
import { isMacOS, isWindows } from '@/utils/platform';
import { cn } from '@/lib/utils';
import { initNotifications } from '@/utils/notifications';
import { startBehaviorSensor, stopBehaviorSensor } from '@/core/runtime/behaviorSensor';
import { useI18n } from '@/i18n';
import { checkForUpdate } from '@/core/updates/checker';
import ErrorBoundary from '@/components/common/ErrorBoundary';
import { syncNanobotSettings, bootstrapNanobotGateway, syncProjectsFromGateway, syncSessionsFromGateway, syncGatewaySettingsToStore } from '@/core/nanobotClient';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useBrowserStore } from '@/stores/browserStore';
import { renderMermaidPng } from '@/core/mermaid';
import { usePromptHubStore } from '@/stores/promptHubStore';
import FirstRunWelcome from '@/components/onboarding/FirstRunWelcome';
import { shouldShowInstallationGuide } from '@/components/onboarding/installationGuide';
import { useAppNavigationHistory } from '@/hooks/useAppNavigationHistory';
import { resolveTitlebarLayout } from '@/core/navigation/titlebarLayout';
import {
  CONVERSATION_SIDEBAR_WIDTH,
  PINNED_SUMMARY_COMPACT_MEDIA_QUERY,
  shouldAutoHideSidebarForPinnedSummary,
} from '@/components/panel/layout';

// These views are only needed after explicit navigation. Keeping them out of
// the initial chat bundle reduces startup work on the common path.
const ScheduleView = lazy(() => import('@/components/schedule/ScheduleView'));
const SystemSettingsView = lazy(() => import('@/components/settings/SystemSettingsModal'));
const ToolboxView = lazy(() => import('@/components/settings/ToolboxModal'));
const ChatView = lazy(() => import('@/components/chat/ChatView'));
const RightPanel = lazy(() => import('@/components/panel/RightPanel'));

function DeferredViewFallback() {
  return <div className="flex h-full items-center justify-center text-sm text-[#77746b]">正在加载…</div>;
}

function DeferredChatFallback({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[45vh] w-full items-center justify-center bg-[#fbfaf7] dark:bg-[#1f1f1f]">
      <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
        <ThinkingOrb state="solving" size={64} style={{ width: 44, height: 44 }} aria-label="" />
        <p className="text-[15px] font-medium leading-6 text-[#88857b] dark:text-[#aaa69e]">
          {label}
        </p>
      </div>
    </div>
  );
}

function scheduleStartupTask(task: () => void | Promise<void>, delayMs: number): void {
  window.setTimeout(() => {
    const run = () => {
      void Promise.resolve(task()).catch((error) => {
        console.warn('[App] Deferred startup task failed:', error);
      });
    };
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 2_000 });
    } else {
      run();
    }
  }, delayMs);
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (
    typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, [query]);

  return matches;
}

function normalizeWorkspaceScope(scope: WorkspaceScopePayload): WorkspaceScopePayload {
  return {
    ...scope,
    project_name: scope.project_name ?? projectNameFromPath(scope.project_path),
    access_mode: 'full',
    restrict_to_workspace: false,
  };
}

function App() {
  const refreshDiscovery = useDiscoveryStore((s) => s.refresh);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const summaryCollapsed = useSettingsStore((s) => s.rightPanelCollapsed);
  const setSummaryCollapsed = useSettingsStore((s) => s.setRightPanelCollapsed);
  const previewArtifact = usePreviewStore((s) => s.previewArtifact);
  const previewExpanded = usePreviewStore((s) => s.isExpanded);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const { t } = useI18n();
  const gatewayBootstrapRef = useRef<Promise<void> | null>(null);
  const startupHydrationScheduledRef = useRef(false);
  const artifactPreviewOpen = previewArtifact !== null;
  const promptHubBaseUrl = usePromptHubStore((s) => s.baseUrl);
  const promptHubToken = usePromptHubStore((s) => s.token);
  const guideShown = useSettingsStore((s) => s.guideShown);
  const guideInstallationId = useSettingsStore((s) => s.guideInstallationId);
  const guideOpen = useSettingsStore((s) => s.guideOpen);
  const setGuideShown = useSettingsStore((s) => s.setGuideShown);
  const setGuideInstallationId = useSettingsStore((s) => s.setGuideInstallationId);
  const closeGuide = useSettingsStore((s) => s.closeGuide);
  const theme = useSettingsStore((s) => s.theme);
  const keyboardShortcuts = useSettingsStore((s) => s.keyboardShortcuts);
  const compactSummaryViewport = useMediaQuery(PINNED_SUMMARY_COMPACT_MEDIA_QUERY);
  const [settingsHydrated, setSettingsHydrated] = useState(() => useSettingsStore.persist.hasHydrated());
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [windowFullScreen, setWindowFullScreen] = useState(false);
  const {
    canGoBack,
    canGoForward,
    goBack,
    goForward,
  } = useAppNavigationHistory(settingsHydrated);

  useEffect(() => {
    if (useSettingsStore.persist.hasHydrated()) {
      setSettingsHydrated(true);
      return;
    }
    return useSettingsStore.persist.onFinishHydration(() => setSettingsHydrated(true));
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    let active = true;
    void windowBridge.getInstallationId()
      .then((value) => {
        if (active) setInstallationId(value?.trim() || 'unavailable-installation');
      })
      .catch((error) => {
        console.warn('[App] Failed to read installation identity:', error);
        if (active) setInstallationId('unavailable-installation');
      });
    return () => {
      active = false;
    };
  }, [settingsHydrated]);

  useEffect(() => {
    let active = true;
    void windowBridge.isFullScreen()
      .then((isFullScreen) => {
        if (active) setWindowFullScreen(isFullScreen);
      })
      .catch(() => {
        if (active) setWindowFullScreen(false);
      });
    const unsubscribe = windowBridge.onFullScreenChanged((isFullScreen) => {
      if (active) setWindowFullScreen(isFullScreen);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useLayoutEffect(() => {
    if (!settingsHydrated) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const root = document.documentElement;
      const isDark = theme === 'dark' || (theme === 'system' && mediaQuery.matches);
      const currentlyDark = root.classList.contains('dark');
      // Keep Electron-owned chrome in lockstep with the renderer. Windows uses
      // native caption buttons over our custom title bar, so their background
      // and glyph colors must follow the active theme as well.
      void windowBridge.setBackgroundColor(isDark ? '#171717' : '#fbfaf7');
      if (isWindows()) {
        void windowBridge.setTitleBarOverlayTheme(isDark);
      }
      // No-op switch (e.g. "system" -> "light" while the OS is already light)
      // must not touch the DOM at all: even toggling the suppression class
      // makes backdrop-filter overlays flicker for a frame.
      if (isDark === currentlyDark) return;
      // Suppress transitions for the duration of the switch so buttons and
      // surfaces land on the new palette in the same frame as the page
      // background (no animated light->dark fade on transitioning elements).
      root.classList.add('theme-transitioning');
      root.classList.toggle('dark', isDark);
      root.style.colorScheme = isDark ? 'dark' : 'light';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => root.classList.remove('theme-transitioning'));
      });
    };

    // useLayoutEffect: flip the .dark class before the browser paints the
    // frame, so toggling the theme never flashes a light frame first (the
    // onboarding gradient is a full-screen surface and makes that flash very
    // visible). The listener setup still happens once per theme/"system".
    applyTheme();
    if (theme !== 'system') return;

    mediaQuery.addEventListener('change', applyTheme);
    return () => mediaQuery.removeEventListener('change', applyTheme);
  }, [settingsHydrated, theme]);

  useEffect(() => {
    const matches = (event: KeyboardEvent, shortcut: string) => {
      const parts = shortcut.toLowerCase().split('+');
      const key = parts.at(-1);
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
      return Boolean(key)
        && event.key.toLowerCase() === key
        && modifierPressed === parts.includes('mod')
        && (isMac || !event.metaKey)
        && !event.altKey
        && !event.shiftKey;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const navigationBack = isMac
        ? event.metaKey && event.key === '['
        : event.altKey && event.key === 'ArrowLeft';
      const navigationForward = isMac
        ? event.metaKey && event.key === ']'
        : event.altKey && event.key === 'ArrowRight';
      if (navigationBack) {
        event.preventDefault();
        goBack();
        return;
      }
      if (navigationForward) {
        event.preventDefault();
        goForward();
        return;
      }
      const shortcut = keyboardShortcuts;
      if (matches(event, shortcut.newChat)) {
        event.preventDefault();
        useChatStore.getState().startNewConversation();
        useSettingsStore.getState().setViewMode('chat');
        window.dispatchEvent(new CustomEvent('nanobot-gui:new-chat'));
      } else if (matches(event, shortcut.focusComposer)) {
        event.preventDefault();
        document.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      } else if (matches(event, shortcut.toggleSidebar)) {
        event.preventDefault();
        const titlebarToggle = document.querySelector<HTMLButtonElement>(
          '[data-sidebar-titlebar-toggle]',
        );
        if (titlebarToggle) titlebarToggle.click();
        else useSettingsStore.getState().toggleSidebar();
      } else if (matches(event, shortcut.openToolbox)) {
        event.preventDefault();
        useSettingsStore.getState().openToolbox();
      } else if (matches(event, shortcut.openSettings)) {
        event.preventDefault();
        useSettingsStore.getState().openSystemSettings('general');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goBack, goForward, keyboardShortcuts]);

  useEffect(() => {
    void ipc.invoke('device-link:configure', {
      baseUrl: promptHubBaseUrl,
      token: promptHubToken ?? '',
    }).catch((error) => {
      console.warn('[App] PromptHub device link configure failed:', error);
    });
  }, [promptHubBaseUrl, promptHubToken]);

  useEffect(() => ipc.on('mermaid:render', async ({ id, code }: { id: string; code: string }) => {
    try {
      const image = await renderMermaidPng(code, `pdf-${id}`);
      await ipc.invoke('mermaid:render-result', { id, image });
    } catch (error) {
      await ipc.invoke('mermaid:render-result', {
        id,
        error: error instanceof Error ? error.message : 'Mermaid render failed',
      });
    }
  }), []);

  useEffect(() => ipc.on(
    'notification:open-conversation',
    ({ conversationId }: { conversationId?: string }) => {
      if (!conversationId) return;
      const chat = useChatStore.getState();
      if (chat.conversations[conversationId]) {
        chat.switchConversation(conversationId);
      } else {
        void syncSessionsFromGateway().then(() => {
          const refreshed = useChatStore.getState();
          if (refreshed.conversations[conversationId]) {
            refreshed.switchConversation(conversationId);
          }
        });
      }
      useSettingsStore.getState().setViewMode('chat');
    },
  ), []);

  // Workspace state — synced from nanobot gateway
  const [workspaces, setWorkspaces] = useState<WorkspacesPayload | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [draftWorkspaceScope, setDraftWorkspaceScope] = useState<WorkspaceScopePayload | null>(null);
  const [workspaceOverrides, setWorkspaceOverrides] = useState<Record<string, WorkspaceScopePayload | null>>({});

  const activeConvId = useChatStore((s) => s.activeConversationId);
  const browserOpen = useBrowserStore((s) => (
    activeConvId ? s.sessions[activeConvId]?.open === true : false
  ));
  const activeConvWorkspacePath = useChatStore((s) =>
    s.activeConversationId ? s.conversations[s.activeConversationId]?.workspacePath ?? null : null
  );
  const activeConvWorkspaceScope = useChatStore((s) =>
    s.activeConversationId ? s.conversations[s.activeConversationId]?.workspaceScope ?? null : null
  );

  const activeWorkspaceScope = useMemo<WorkspaceScopePayload | null>(() => {
    if (activeConvId && Object.prototype.hasOwnProperty.call(workspaceOverrides, activeConvId)) {
      return workspaceOverrides[activeConvId] ?? null;
    }
    if (activeConvWorkspaceScope) {
      return normalizeWorkspaceScope(activeConvWorkspaceScope);
    }
    if (activeConvWorkspacePath) {
      return {
        project_path: activeConvWorkspacePath,
        project_name: projectNameFromPath(activeConvWorkspacePath),
        access_mode: 'full',
        restrict_to_workspace: false,
      };
    }
    if (activeConvId) return null;
    return draftWorkspaceScope ? normalizeWorkspaceScope(draftWorkspaceScope) : null;
  }, [activeConvId, activeConvWorkspacePath, activeConvWorkspaceScope, draftWorkspaceScope, workspaceOverrides]);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const status = await getNanobotStatus();
      if (!status.ready) return;
      const token = getNanobotToken();
      const base = `http://127.0.0.1:${status.port}`;
      const payload = await fetchWorkspaces(token, base);
      setWorkspaces(payload);
    } catch {
      setWorkspaces(null);
    }
  }, []);

  // Fetch workspaces once gateway is ready (after syncNanobotSettings resolves)
  // We do this in the bootstrap effect below; also refresh on session updates.

  const applyWorkspaceScope = useCallback((scope: WorkspaceScopePayload | null) => {
    setWorkspaceError(null);
    if (!scope) {
      if (activeConvId) {
        useChatStore.getState().setConversationWorkspaceScope(activeConvId, null);
        setWorkspaceOverrides((current) => ({ ...current, [activeConvId]: null }));
        return;
      }
      setDraftWorkspaceScope(null);
      return;
    }

    const next = normalizeWorkspaceScope(scope);
    useWorkspaceStore.getState().setWorkspace(next.project_path);
    if (activeConvId) {
      try {
        const client = getNanobotClient();
        client.setWorkspaceScope(activeConvId, next);
      } catch {
        // client not ready yet — just update local state
      }
      useChatStore.getState().setConversationWorkspaceScope(activeConvId, next);
      setWorkspaceOverrides((current) => ({ ...current, [activeConvId]: next }));
      return;
    }
    setDraftWorkspaceScope(next);
  }, [activeConvId]);

  // Listen for nanobot backend error events
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;
    eventBridge.listen('nanobot-error', (msg: string) => {
      useToastStore.getState().addToast({
        title: 'Nanobot 错误',
        message: msg,
        type: 'error',
        duration: 5000,
      });
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenFn = fn;
    });
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  // Listen for workspace scope updates pushed from nanobot gateway
  useEffect(() => {
    let client;
    try { client = getNanobotClient(); } catch { return; }
    return client.onSessionUpdate((
      _chatId,
      _scope,
      workspaceScope,
      expertTeam,
      sessionId,
      projectId,
    ) => {
      if (sessionId || projectId) {
        useChatStore.getState().setConversationIdentity(_chatId, sessionId, projectId);
      }
      if (workspaceScope) {
        const next = normalizeWorkspaceScope(workspaceScope);
        useChatStore.getState().setConversationWorkspaceScope(_chatId, next);
        setWorkspaceOverrides((current) => ({ ...current, [_chatId]: next }));
        setWorkspaceError(null);
        void refreshWorkspaces();
        void syncProjectsFromGateway();
      }
      if (expertTeam !== undefined) {
        useChatStore.getState().setConversationExpertTeam(_chatId, expertTeam);
      }
    });
  });

  useEffect(() => {
    const resetDraftWorkspace = (event: Event) => {
      const projectPath = (event as CustomEvent<{ projectPath?: string }>).detail?.projectPath;
      setDraftWorkspaceScope(projectPath ? {
        project_path: projectPath,
        project_name: projectNameFromPath(projectPath),
        access_mode: 'full',
        restrict_to_workspace: false,
      } : null);
      setWorkspaceError(null);
      void refreshWorkspaces();
    };
    window.addEventListener('nanobot-gui:new-chat', resetDraftWorkspace);
    window.addEventListener('nanobot-gui:workspace-settings-changed', resetDraftWorkspace);
    return () => {
      window.removeEventListener('nanobot-gui:new-chat', resetDraftWorkspace);
      window.removeEventListener('nanobot-gui:workspace-settings-changed', resetDraftWorkspace);
    };
  }, [refreshWorkspaces]);

  useEffect(() => {
    const refreshAfterGatewayReconnect = () => {
      void refreshWorkspaces();
    };
    window.addEventListener(
      'nanobot-gui:gateway-reconnected',
      refreshAfterGatewayReconnect,
    );
    return () => {
      window.removeEventListener(
        'nanobot-gui:gateway-reconnected',
        refreshAfterGatewayReconnect,
      );
    };
  }, [refreshWorkspaces]);

  // Handle workspace_scope_rejected errors from nanobot gateway
  useEffect(() => {
    let client;
    try { client = getNanobotClient(); } catch { return; }
    return client.onError((error) => {
      if (error.kind !== 'workspace_scope_rejected') return;
      setWorkspaceError(
        error.reason === 'session_project_mismatch'
          ? '会话创建后不能切换到其他工作空间；请在目标工作空间中新建对话'
          : '工作区路径被拒绝，请确认路径有效且应用有权访问',
      );
      if (error.chatId) {
        setWorkspaceOverrides((current) => {
          const next = { ...current };
          delete next[error.chatId!];
          return next;
        });
        void syncSessionsFromGateway();
      }
      void refreshWorkspaces();
    });
  });

  useEffect(() => {
    refreshDiscovery();

    // Initialize notifications with logging
    initNotifications().then((granted) => {
      console.log('[App] Notification permission initialized:', granted);
    }).catch((err) => {
      console.error('[App] Notification init error:', err);
    });

  }, [refreshDiscovery]);

  // Behavior sensor — controlled by setting
  const behaviorSensorEnabled = useSettingsStore((s) => s.behaviorSensorEnabled);
  useEffect(() => {
    if (behaviorSensorEnabled) {
      startBehaviorSensor();
    } else {
      stopBehaviorSensor();
    }
    return () => stopBehaviorSensor();
  }, [behaviorSensorEnabled]);

  // Check for updates on startup (throttled to once per 24h)
  useEffect(() => {
    checkForUpdate().catch((err) => {
      console.warn('[App] Update check error:', err);
    });
  }, []);

  // Hide native title bar text on macOS (overlay mode — title shown in sidebar instead)
  // On Windows, show app name in native title bar
  useEffect(() => {
    windowBridge.setTitle(isMacOS() ? '' : t.common.appName);
  }, [t.common.appName]);

  // Sync settings and start nanobot bridge
  const apiKey = useSettingsStore((s) => s.apiKey);
  const baseUrl = useSettingsStore((s) => s.baseUrl);
  const provider = useSettingsStore((s) => s.provider);
  const apiFormat = useSettingsStore((s) => s.apiFormat);
  const effectiveModel = useSettingsStore(getEffectiveModel);
  const temperature = useSettingsStore((s) => s.temperature);
  const enableThinking = useSettingsStore((s) => s.enableThinking);
  const thinkingBudget = useSettingsStore((s) => s.thinkingBudget);
  const useBuiltinWebSearch = useSettingsStore((s) => s.useBuiltinWebSearch);
  const webSearchProvider = useSettingsStore((s) => s.webSearchProvider);
  const webSearchApiKey = useSettingsStore((s) => s.webSearchApiKey);
  const webSearchBaseUrl = useSettingsStore((s) => s.webSearchBaseUrl);
  const networkWhitelist = useSettingsStore((s) => s.networkWhitelist);
  const webuiAllowLocalServiceAccess = useSettingsStore((s) => s.allowPrivateNetworks);

  useEffect(() => {
    let cancelled = false;

    void syncNanobotSettings({
      apiKey,
      baseUrl,
      model: effectiveModel,
      provider,
      apiFormat,
      temperature,
      enableThinking,
      thinkingBudget,
      useBuiltinWebSearch,
      webSearchProvider,
      webSearchApiKey,
      webSearchBaseUrl,
      restrictToWorkspace: false,
      networkWhitelist,
      webuiAllowLocalServiceAccess,
    }).then(async (res) => {
      if (!res.ok) {
        console.error('[App] Nanobot settings sync failed:', res.error);
        return;
      }

      console.log('[App] Nanobot settings synced and bridge started successfully');
      const needsBootstrap = res.restarted || getNanobotConnectionStatus() !== 'open';
      if (needsBootstrap) {
        if (!gatewayBootstrapRef.current) {
          gatewayBootstrapRef.current = bootstrapNanobotGateway()
            .then(() => undefined)
            .finally(() => {
              gatewayBootstrapRef.current = null;
            });
        }
        await gatewayBootstrapRef.current;
      }
      if (cancelled) return;

      console.log(`[App] Nanobot gateway bootstrap completed at ${Math.round(performance.now())}ms`);
      const status = await getNanobotStatus();
      const base = `http://127.0.0.1:${status.port}`;
      void updateNetworkSafetySettings(getNanobotToken(), {
        webuiAllowLocalServiceAccess,
        webuiDefaultAccessMode: 'full',
      }, base).catch((err) => {
        console.warn('[App] Failed to apply full access default:', err);
      });

      if (startupHydrationScheduledRef.current) return;
      startupHydrationScheduledRef.current = true;

      // Conversation metadata and workspaces affect the visible shell, so
      // hydrate them first. Toolbox, schedule and settings data are deferred
      // to avoid a burst of parsing/store updates immediately after first paint.
      void syncSessionsFromGateway().then(() => {
        console.log('[App] Session history sync completed');
      });
      void refreshWorkspaces();
      scheduleStartupTask(refreshDiscovery, 150);
      scheduleStartupTask(async () => {
        await syncProjectsFromGateway();
        console.log('[App] Project registry sync completed');
      }, 300);
      scheduleStartupTask(async () => {
        await useScheduleStore.getState().loadTasks();
        console.log('[App] Scheduled tasks sync completed');
      }, 500);
      scheduleStartupTask(async () => {
        await syncGatewaySettingsToStore();
        console.log('[App] Settings synced from gateway');
      }, 700);
    }).catch((err) => {
      console.error('[App] Nanobot settings sync exception:', err);
    });

    return () => {
      cancelled = true;
    };
  }, [
    apiKey,
    baseUrl,
    provider,
    apiFormat,
    effectiveModel,
    temperature,
    enableThinking,
    thinkingBudget,
    useBuiltinWebSearch,
    webSearchProvider,
    webSearchApiKey,
    webSearchBaseUrl,
    networkWhitelist,
    webuiAllowLocalServiceAccess,
    refreshWorkspaces,
    refreshDiscovery,
  ]);

  // macOS shares this row with the traffic lights. Windows uses Electron's
  // title-bar overlay so the native caption buttons stay on the right while
  // our sidebar and history controls occupy the upper-left, like Codex.
  const mac = isMacOS();
  const windows = isWindows();
  const customTitlebar = mac || windows;
  const autoHideSidebarForSummary = shouldAutoHideSidebarForPinnedSummary({
    windows,
    compactViewport: compactSummaryViewport,
    chatVisible: viewMode === 'chat' || !viewMode,
    hasActiveConversation: !!activeConvId,
    summaryCollapsed,
    previewOpen: artifactPreviewOpen,
    browserOpen,
  });
  const effectiveSidebarCollapsed = sidebarCollapsed || autoHideSidebarForSummary;
  const sidebarVisible = !artifactPreviewOpen && !previewExpanded && !effectiveSidebarCollapsed;
  const titlebarLayout = resolveTitlebarLayout({
    isMac: mac,
    isWindows: windows,
    isFullScreen: windowFullScreen,
    sidebarCollapsed: effectiveSidebarCollapsed,
    sidebarVisible,
  });
  const shellTransitionDelay = artifactPreviewOpen || previewExpanded || autoHideSidebarForSummary
    ? '0ms'
    : '180ms';
  const handleSidebarToggle = () => {
    if (autoHideSidebarForSummary) {
      setSummaryCollapsed(true);
      if (sidebarCollapsed) toggleSidebar();
      return;
    }
    toggleSidebar();
  };

  if (!settingsHydrated || !installationId) {
    return <div className="h-full w-full bg-[#fbfaf7]" />;
  }

  const showInstallationGuide = shouldShowInstallationGuide({
    guideShown,
    guideOpen,
    completedInstallationId: guideInstallationId,
    currentInstallationId: installationId,
  });

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={200}>
        {showInstallationGuide && (
          <FirstRunWelcome
            onContinue={() => {
              setGuideShown(true);
              setGuideInstallationId(installationId);
              closeGuide();
            }}
          />
        )}
        {customTitlebar && (
          <div
            data-window-titlebar
            data-window-titlebar-platform={windows ? 'windows' : 'macos'}
            className={cn(
              'window-titlebar-drag fixed left-0 right-0 top-0 z-40',
              windows ? 'h-9' : 'h-12',
              windows && 'border-b border-[#e5e2db] bg-[#f7f6f2] dark:border-[#3d3d3d] dark:bg-[#242424]',
            )}
          >
            {windows && <AppTitlebarMenu />}
          </div>
        )}

        <div
          className={cn(
            'pointer-events-none fixed left-0 right-0 top-0 z-[60] transition-opacity duration-150',
            previewExpanded && 'opacity-0 [&_button]:pointer-events-none',
            windows ? 'h-9' : customTitlebar ? 'h-12' : 'h-8',
          )}
          style={{ transitionDelay: shellTransitionDelay }}
        >
          <div
            className="window-titlebar-no-drag pointer-events-auto absolute flex items-center gap-1 transition-[left] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
            style={{
              top: customTitlebar ? (windows ? 4 : 10) : 4,
              left: titlebarLayout.navigationLeft,
              transitionDelay: shellTransitionDelay,
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleSidebarToggle}
                  data-sidebar-titlebar-toggle
                  className={cn(
                    'flex items-center justify-center rounded-lg text-[#656358] transition-colors hover:bg-[#ded9cf] hover:text-[#29261b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/40 dark:text-[#d8d5ce] dark:hover:bg-[#57534d] dark:hover:text-white',
                    windows ? 'mr-2 h-7 w-7' : 'h-7 w-7',
                  )}
                  aria-label={effectiveSidebarCollapsed ? t.sidebar.showSidebar : t.sidebar.hideSidebar}
                >
                  <PanelLeft className={windows ? 'h-[18px] w-[18px]' : 'h-[17px] w-[17px]'} strokeWidth={1.8} />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                sideOffset={8}
                className="border border-white/10 bg-[#292824] px-2.5 py-1 text-[12px] font-medium text-white shadow-lg [&>svg]:hidden"
              >
                {effectiveSidebarCollapsed ? t.sidebar.showSidebar : t.sidebar.hideSidebar}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={goBack}
                  disabled={!canGoBack}
                  data-titlebar-back
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-[#656358] transition-colors hover:bg-[#ded9cf] hover:text-[#29261b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/40 disabled:cursor-default disabled:text-[#b8b5ae] disabled:hover:bg-transparent dark:text-[#d8d5ce] dark:hover:bg-[#57534d] dark:hover:text-white dark:disabled:text-[#67645f]"
                  aria-label={t.sidebar.goBack}
                >
                  <ArrowLeft className={windows ? 'h-[18px] w-[18px]' : 'h-[17px] w-[17px]'} strokeWidth={1.8} />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                sideOffset={8}
                className="border border-white/10 bg-[#292824] px-2.5 py-1 text-[12px] font-medium text-white shadow-lg [&>svg]:hidden"
              >
                {t.sidebar.goBack}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={goForward}
                  disabled={!canGoForward}
                  data-titlebar-forward
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-[#656358] transition-colors hover:bg-[#ded9cf] hover:text-[#29261b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/40 disabled:cursor-default disabled:text-[#b8b5ae] disabled:hover:bg-transparent dark:text-[#d8d5ce] dark:hover:bg-[#57534d] dark:hover:text-white dark:disabled:text-[#67645f]"
                  aria-label={t.sidebar.goForward}
                >
                  <ArrowRight className={windows ? 'h-[18px] w-[18px]' : 'h-[17px] w-[17px]'} strokeWidth={1.8} />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                sideOffset={8}
                className="border border-white/10 bg-[#292824] px-2.5 py-1 text-[12px] font-medium text-white shadow-lg [&>svg]:hidden"
              >
                {t.sidebar.goForward}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="flex h-full w-full">
          {/* Sidebar */}
          <div
            data-sidebar-auto-hidden={autoHideSidebarForSummary ? 'true' : 'false'}
            className={cn(
              'sidebar-transition shrink-0 overflow-hidden transition-opacity duration-150',
              (artifactPreviewOpen || previewExpanded) && 'pointer-events-none',
            )}
            style={{
              width: artifactPreviewOpen || previewExpanded || effectiveSidebarCollapsed
                ? 0
                : CONVERSATION_SIDEBAR_WIDTH,
              opacity: artifactPreviewOpen || previewExpanded || effectiveSidebarCollapsed ? 0 : 1,
              transitionDelay: shellTransitionDelay,
            }}
          >
            <Sidebar />
          </div>

          {/* Custom title bars live inside the renderer, so content starts below them. */}
          <main
            className={cn(
              'flex-1 min-w-0 bg-[#fbfaf7] transition-opacity duration-150',
              previewExpanded && 'pointer-events-none overflow-hidden opacity-0',
              mac ? 'pt-12' : windows && 'pt-9',
            )}
            style={{
              transitionDelay: shellTransitionDelay,
              '--conversation-header-leading-inset': `${titlebarLayout.conversationLeadingInset}px`,
              '--conversation-header-transition-delay': shellTransitionDelay,
            } as CSSProperties}
          >
            <Suspense fallback={<DeferredViewFallback />}>
              {viewMode === 'schedule' && <ScheduleView />}
              {viewMode === 'toolbox' && <ToolboxView />}
              {viewMode === 'settings' && <SystemSettingsView />}
            </Suspense>
            {(viewMode === 'chat' || !viewMode) && (
              <Suspense fallback={<DeferredChatFallback label={t.chat.appLoading} />}>
                <ChatView
                  workspaceScope={activeWorkspaceScope}
                  workspaceDefaultScope={workspaces?.default_scope ?? null}
                  workspaceControls={workspaces?.controls ?? null}
                  workspaceError={workspaceError}
                  onWorkspaceScopeChange={applyWorkspaceScope}
                />
              </Suspense>
            )}
          </main>

          {/* Right panel */}
          <Suspense fallback={null}>
            <RightPanel />
          </Suspense>

          <ToastContainer />
        </div>
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
