import { lazy, Suspense, useEffect, useState, useCallback, useMemo } from 'react';
import { ipc, windowBridge, eventBridge } from '@/lib/ipc-factory';
import Sidebar from '@/components/sidebar/Sidebar';
import ChatView from '@/components/chat/ChatView';
import RightPanel from '@/components/panel/RightPanel';
import ToastContainer from '@/components/common/ToastContainer';
import { useToastStore } from '@/stores/toastStore';
import { initPlatform } from '@/utils/platform';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { initNetworkProxy } from '@/core/sandbox/config';
import type { WorkspaceScopePayload, WorkspacesPayload } from '@/core/types';
import { fetchWorkspaces, updateNetworkSafetySettings } from '@/core/api';
import { getNanobotClient, getNanobotToken, getNanobotStatus } from '@/core/nanobotClient';
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
import { isMacOS } from '@/utils/platform';
import { cn } from '@/lib/utils';
import { initNotifications } from '@/utils/notifications';
import { startBehaviorSensor, stopBehaviorSensor } from '@/core/runtime/behaviorSensor';
import { useI18n } from '@/i18n';
import CloseDialog from '@/components/common/CloseDialog';
import { checkForUpdate } from '@/core/updates/checker';
import ErrorBoundary from '@/components/common/ErrorBoundary';
import { syncNanobotSettings, bootstrapNanobotGateway, syncProjectsFromGateway, syncSessionsFromGateway, syncGatewaySettingsToStore } from '@/core/nanobotClient';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { usePreviewStore } from '@/stores/previewStore';
import { renderMermaidPng } from '@/core/mermaid';
import { usePromptHubStore } from '@/stores/promptHubStore';
import FirstRunWelcome from '@/components/onboarding/FirstRunWelcome';
import { useAppNavigationHistory } from '@/hooks/useAppNavigationHistory';

// These views are only needed after explicit navigation. Keeping them out of
// the initial chat bundle reduces startup work on the common path.
const ScheduleView = lazy(() => import('@/components/schedule/ScheduleView'));
const SystemSettingsView = lazy(() => import('@/components/settings/SystemSettingsModal'));
const ToolboxView = lazy(() => import('@/components/settings/ToolboxModal'));

function DeferredViewFallback() {
  return <div className="flex h-full items-center justify-center text-sm text-[#77746b]">正在加载…</div>;
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
  const previewArtifact = usePreviewStore((s) => s.previewArtifact);
  const previewExpanded = usePreviewStore((s) => s.isExpanded);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const { t } = useI18n();
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const artifactPreviewOpen = previewArtifact !== null;
  const promptHubBaseUrl = usePromptHubStore((s) => s.baseUrl);
  const promptHubToken = usePromptHubStore((s) => s.token);
  const guideShown = useSettingsStore((s) => s.guideShown);
  const setGuideShown = useSettingsStore((s) => s.setGuideShown);
  const theme = useSettingsStore((s) => s.theme);
  const keyboardShortcuts = useSettingsStore((s) => s.keyboardShortcuts);
  const [settingsHydrated, setSettingsHydrated] = useState(() => useSettingsStore.persist.hasHydrated());
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

  useEffect(() => {
    if (!settingsHydrated) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const isDark = theme === 'dark' || (theme === 'system' && mediaQuery.matches);
      document.documentElement.classList.toggle('dark', isDark);
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    };

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
        useSettingsStore.getState().toggleSidebar();
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

  // Workspace state — synced from nanobot gateway
  const [workspaces, setWorkspaces] = useState<WorkspacesPayload | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [draftWorkspaceScope, setDraftWorkspaceScope] = useState<WorkspaceScopePayload | null>(null);
  const [workspaceOverrides, setWorkspaceOverrides] = useState<Record<string, WorkspaceScopePayload | null>>({});

  const activeConvId = useChatStore((s) => s.activeConversationId);
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
      const parts = activeConvWorkspacePath.split('/').filter(Boolean);
      return {
        project_path: activeConvWorkspacePath,
        project_name: parts[parts.length - 1] || activeConvWorkspacePath,
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

  const handleQuit = useCallback(() => {
    setShowCloseDialog(false);
    ipc.invoke('app_exit');
  }, []);

  const handleMinimize = useCallback(() => {
    setShowCloseDialog(false);
    ipc.invoke('window_hide');
  }, []);

  // Listen for window close-requested event from Rust
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;
    eventBridge.listen('close-requested', () => {
      const action = useSettingsStore.getState().closeAction;
      if (action === 'quit') {
        ipc.invoke('app_exit');
      } else if (action === 'minimize') {
        ipc.invoke('window_hide');
      } else {
        setShowCloseDialog(true);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenFn = fn;
    });
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

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

  // Handle workspace_scope_rejected errors from nanobot gateway
  useEffect(() => {
    let client;
    try { client = getNanobotClient(); } catch { return; }
    return client.onError((error) => {
      if (error.kind !== 'workspace_scope_rejected') return;
      setWorkspaceError(
        error.reason === 'session_project_mismatch'
          ? '会话创建后不能切换到其他项目；请在目标项目中新建对话'
          : '工作区路径被拒绝，请确认路径有效且 nanobot 有权访问',
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
    syncNanobotSettings({
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
    }).then((res) => {
      if (res.ok) {
        console.log('[App] Nanobot settings synced and bridge started successfully');
        bootstrapNanobotGateway().then(async () => {
          console.log('[App] Nanobot gateway bootstrap completed');
          const status = await getNanobotStatus();
          const base = `http://127.0.0.1:${status.port}`;
          updateNetworkSafetySettings(getNanobotToken(), {
            webuiAllowLocalServiceAccess,
            webuiDefaultAccessMode: 'full',
          }, base).catch((err) => {
            console.warn('[App] Failed to apply full access default:', err);
          }).finally(() => {
            syncGatewaySettingsToStore().then(() => {
              console.log('[App] Settings synced from gateway');
            });
            void refreshWorkspaces();
          });
          void Promise.all([
            syncSessionsFromGateway().then(() => {
              console.log('[App] Session history sync completed');
            }),
            syncProjectsFromGateway().then(() => {
              console.log('[App] Project registry sync completed');
            }),
          ]);
          useScheduleStore.getState().loadTasks().then(() => {
            console.log('[App] Scheduled tasks sync completed');
          });
        }).catch((err) => {
          console.error('[App] Nanobot gateway bootstrap failed:', err);
        });
      } else {
        console.error('[App] Nanobot settings sync failed:', res.error);
      }
    }).catch((err) => {
      console.error('[App] Nanobot settings sync exception:', err);
    });
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
  ]);

  // macOS uses a full-size hidden title bar so renderer controls can sit beside
  // the native traffic lights. Windows and Linux keep their native title bars.
  const mac = isMacOS();

  if (!settingsHydrated) {
    return <div className="h-full w-full bg-[#fbfaf7]" />;
  }

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={200}>
        {!guideShown && <FirstRunWelcome onContinue={() => setGuideShown(true)} />}
        {mac && (
          <div
            data-window-titlebar
            className="window-titlebar-drag fixed left-0 right-0 top-0 z-40 h-9"
          />
        )}

        <div
          className={cn(
            'pointer-events-none fixed left-0 right-0 top-0 z-50 transition-opacity duration-150',
            previewExpanded && 'opacity-0 [&_button]:pointer-events-none',
            mac ? 'h-9' : 'h-8',
          )}
          style={{ transitionDelay: previewExpanded ? '0ms' : '180ms' }}
        >
          <div
            className="window-titlebar-no-drag pointer-events-auto absolute flex items-center gap-1 transition-[left] duration-200"
            style={{
              top: 4,
              left: windowFullScreen
                ? 12
                : mac ? 92 : sidebarCollapsed ? 70 : 232,
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  data-sidebar-titlebar-toggle
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-[#656358] transition-colors hover:bg-[#ded9cf] hover:text-[#29261b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/40 dark:text-[#d8d5ce] dark:hover:bg-[#57534d] dark:hover:text-white"
                  aria-label={sidebarCollapsed ? t.sidebar.showSidebar : t.sidebar.hideSidebar}
                >
                  <PanelLeft className="h-[17px] w-[17px]" strokeWidth={1.8} />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                sideOffset={8}
                className="border border-white/10 bg-[#292824] px-2.5 py-1 text-[12px] font-medium text-white shadow-lg [&>svg]:hidden"
              >
                {sidebarCollapsed ? t.sidebar.showSidebar : t.sidebar.hideSidebar}
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
                  <ArrowLeft className="h-[17px] w-[17px]" strokeWidth={1.8} />
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
                  <ArrowRight className="h-[17px] w-[17px]" strokeWidth={1.8} />
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
            className={cn(
              'sidebar-transition shrink-0 overflow-hidden transition-opacity duration-150',
              (artifactPreviewOpen || previewExpanded) && 'pointer-events-none',
            )}
            style={{
              width: artifactPreviewOpen || previewExpanded ? 0 : sidebarCollapsed ? 0 : 260,
              opacity: artifactPreviewOpen || previewExpanded ? 0 : 1,
              transitionDelay: artifactPreviewOpen || previewExpanded ? '0ms' : '180ms',
            }}
          >
            <Sidebar />
          </div>

          {/* Main clears the custom macOS title bar; native title bars consume their own space. */}
          <main
            className={cn(
              'flex-1 min-w-0 bg-[#fbfaf7] transition-opacity duration-150',
              previewExpanded && 'pointer-events-none overflow-hidden opacity-0',
              mac && 'pt-9',
            )}
            style={{ transitionDelay: previewExpanded ? '0ms' : '180ms' }}
          >
            <Suspense fallback={<DeferredViewFallback />}>
              {viewMode === 'schedule' && <ScheduleView />}
              {viewMode === 'toolbox' && <ToolboxView />}
              {viewMode === 'settings' && <SystemSettingsView />}
            </Suspense>
            {(viewMode === 'chat' || !viewMode) && (
              <ChatView
                workspaceScope={activeWorkspaceScope}
                workspaceDefaultScope={workspaces?.default_scope ?? null}
                workspaceControls={workspaces?.controls ?? null}
                workspaceError={workspaceError}
                onWorkspaceScopeChange={applyWorkspaceScope}
              />
            )}
          </main>

          {/* Right panel */}
          <RightPanel />

          <ToastContainer />

          <CloseDialog
            open={showCloseDialog}
            onQuit={handleQuit}
            onMinimize={handleMinimize}
            onCancel={() => setShowCloseDialog(false)}
            onCloseActionChange={useSettingsStore.getState().setCloseAction}
          />
        </div>
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
