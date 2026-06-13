import { useEffect, useState, useCallback, useMemo } from 'react';
import { ipc, windowBridge, eventBridge } from '@/lib/ipc-factory';
import Sidebar from '@/components/sidebar/Sidebar';
import ChatView from '@/components/chat/ChatView';
import ScheduleView from '@/components/schedule/ScheduleView';
import SystemSettingsView from '@/components/settings/SystemSettingsModal';
import ToolboxView from '@/components/settings/ToolboxModal';
import RightPanel from '@/components/panel/RightPanel';
import ToastContainer from '@/components/common/ToastContainer';
import { useToastStore } from '@/stores/toastStore';
import { initPlatform } from '@/utils/platform';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { initNetworkProxy } from '@/core/sandbox/config';
import type { WorkspaceScopePayload, WorkspacesPayload } from '@/core/types';
import { fetchWorkspaces } from '@/core/api';
import { getNanobotClient, getNanobotToken, getNanobotStatus } from '@/core/nanobotClient';
import { projectNameFromPath } from '@/core/workspace';
import { useChatStore } from '@/stores/chatStore';

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
import { syncNanobotSettings, bootstrapNanobotGateway, syncSessionsFromGateway, syncGatewaySettingsToStore } from '@/core/nanobotClient';

function normalizeWorkspaceScope(scope: WorkspaceScopePayload): WorkspaceScopePayload {
  const accessMode = scope.access_mode === 'restricted' ? 'restricted' : 'full';
  return {
    ...scope,
    project_name: scope.project_name ?? projectNameFromPath(scope.project_path),
    access_mode: accessMode,
    restrict_to_workspace: accessMode === 'restricted',
  };
}

function App() {
  const refreshDiscovery = useDiscoveryStore((s) => s.refresh);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const { t } = useI18n();
  const [showCloseDialog, setShowCloseDialog] = useState(false);

  // Workspace state — synced from nanobot gateway
  const [workspaces, setWorkspaces] = useState<WorkspacesPayload | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [draftWorkspaceScope, setDraftWorkspaceScope] = useState<WorkspaceScopePayload | null>(null);
  const [workspaceOverrides, setWorkspaceOverrides] = useState<Record<string, WorkspaceScopePayload>>({});

  const activeConvId = useChatStore((s) => s.activeConversationId);
  const activeConvWorkspacePath = useChatStore((s) =>
    s.activeConversationId ? s.conversations[s.activeConversationId]?.workspacePath ?? null : null
  );
  const activeConvWorkspaceScope = useChatStore((s) =>
    s.activeConversationId ? s.conversations[s.activeConversationId]?.workspaceScope ?? null : null
  );

  const activeWorkspaceScope = useMemo<WorkspaceScopePayload | null>(() => {
    if (activeConvId && workspaceOverrides[activeConvId]) {
      return workspaceOverrides[activeConvId];
    }
    if (activeConvWorkspaceScope) {
      return normalizeWorkspaceScope(activeConvWorkspaceScope);
    }
    if (activeConvWorkspacePath) {
      const parts = activeConvWorkspacePath.split('/').filter(Boolean);
      return {
        project_path: activeConvWorkspacePath,
        project_name: parts[parts.length - 1] || activeConvWorkspacePath,
        access_mode: 'restricted',
        restrict_to_workspace: true,
      };
    }
    return draftWorkspaceScope ?? workspaces?.default_scope ?? null;
  }, [activeConvId, activeConvWorkspacePath, activeConvWorkspaceScope, draftWorkspaceScope, workspaceOverrides, workspaces?.default_scope]);

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

  const applyWorkspaceScope = useCallback((scope: WorkspaceScopePayload) => {
    const next = normalizeWorkspaceScope(scope);
    setWorkspaceError(null);
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
    return client.onSessionUpdate((_chatId, _scope, workspaceScope) => {
      if (!workspaceScope) return;
      const next = normalizeWorkspaceScope(workspaceScope);
      useChatStore.getState().setConversationWorkspaceScope(_chatId, next);
      setWorkspaceOverrides((current) => ({ ...current, [_chatId]: next }));
      setDraftWorkspaceScope(next);
      setWorkspaceError(null);
      void refreshWorkspaces();
    });
  });

  // Handle workspace_scope_rejected errors from nanobot gateway
  useEffect(() => {
    let client;
    try { client = getNanobotClient(); } catch { return; }
    return client.onError((error) => {
      if (error.kind !== 'workspace_scope_rejected') return;
      setWorkspaceError('工作区路径被拒绝，请确认路径有效且 nanobot 有权访问');
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
    windowBridge.setTitle(isMacOS() ? '' : 'Ruyi');
  }, []);

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
  const sandboxEnabled = useSettingsStore((s) => s.sandboxEnabled);
  const networkWhitelist = useSettingsStore((s) => s.networkWhitelist);
  const allowPrivateNetworks = useSettingsStore((s) => s.allowPrivateNetworks);

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
      sandboxEnabled,
      networkWhitelist,
      allowPrivateNetworks,
    }).then((res) => {
      if (res.ok) {
        console.log('[App] Nanobot settings synced and bridge started successfully');
        bootstrapNanobotGateway().then(() => {
          console.log('[App] Nanobot gateway bootstrap completed');
          syncGatewaySettingsToStore().then(() => {
            console.log('[App] Settings synced from gateway');
          });
          syncSessionsFromGateway().then(() => {
            console.log('[App] Session history sync completed');
          });
          void refreshWorkspaces();
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
    sandboxEnabled,
    networkWhitelist,
    allowPrivateNetworks,
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
        <div className={cn('fixed left-0 right-0 z-40 pointer-events-none', mac ? 'top-0 h-7' : 'top-0 h-8')}>
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
            className="sidebar-transition shrink-0 overflow-hidden"
            style={{ width: sidebarCollapsed ? 0 : 260 }}
          >
            <Sidebar />
          </div>

          {/* Main — pt-7 on macOS to clear overlay title bar; no padding on Windows (native title bar) */}
          <main className={cn('flex-1 min-w-0 bg-[#fbfaf7]', mac && 'pt-7')}>
            {viewMode === 'schedule' && <ScheduleView />}
            {viewMode === 'toolbox' && <ToolboxView />}
            {viewMode === 'settings' && <SystemSettingsView />}
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
