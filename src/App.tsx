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
import { TooltipProvider } from '@/components/ui/tooltip';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
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

  // macOS uses overlay title bar (content behind traffic lights); Windows uses native title bar
  const mac = isMacOS();

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={200}>
        {/* Title bar drag region — only needed on macOS where we use overlay title bar */}
        {mac && (
          <div
            className="fixed top-0 left-0 right-0 h-7 z-40 [app-region:drag]"
          />
        )}

        {/* Sidebar & panel toggle buttons — positioned in title bar area on macOS, top bar on Windows */}
        <div
          className={cn(
            'fixed left-0 right-0 z-40 pointer-events-none transition-opacity duration-150',
            (artifactPreviewOpen || previewExpanded) && 'opacity-0 [&_button]:pointer-events-none',
            mac ? 'top-0 h-7' : 'top-0 h-8',
          )}
          style={{ transitionDelay: artifactPreviewOpen || previewExpanded ? '0ms' : '180ms' }}
        >
          <button
            onClick={toggleSidebar}
            className="absolute btn-ghost p-1 text-[#656358] hover:text-[#29261b] hover:bg-[#e8e5de]/80 rounded-md transition-[left] duration-200 pointer-events-auto"
            style={{ top: mac ? 6 : 4, left: sidebarCollapsed ? 70 : 232 }}
            title={sidebarCollapsed ? t.sidebar.showSidebar : t.sidebar.hideSidebar}
          >
            {sidebarCollapsed
              ? <PanelLeftOpen className="h-3.5 w-3.5" />
              : <PanelLeftClose className="h-3.5 w-3.5" />}
          </button>
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

          {/* Main — pt-7 on macOS to clear overlay title bar; no padding on Windows (native title bar) */}
          <main
            className={cn(
              'flex-1 min-w-0 bg-[#fbfaf7] transition-opacity duration-150',
              previewExpanded && 'pointer-events-none overflow-hidden opacity-0',
              mac && 'pt-7',
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
