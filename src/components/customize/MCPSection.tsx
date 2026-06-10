import { useState, useMemo, useEffect } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useMCPStore, type MCPServerEntry } from '@/stores/mcpStore';
import { useI18n } from '@/i18n';
import { mcpTemplates } from '@/data/marketplace/mcp';
import { mcpManager, type MCPServerConfig, type MCPLogEntry } from '@/core/mcp/client';
import { parseArgs } from '@/utils/argsParser';
import SubTabBar from './SubTabBar';
import { Trash2, Plus, Loader2, Check, X, Plug, PlugZap, ChevronDown, ChevronRight, Wrench, Zap, AlertCircle, ScrollText, Server } from 'lucide-react';
import { cn } from '@/lib/utils';
import { shellBridge } from '@/lib/ipc-factory';

type MCPSubTab = 'connected' | 'configured' | 'recommended';

const urlPattern = /https?:\/\/[^\s]+/;

/** Render setupHint text with URLs converted to clickable links */
function renderSetupHint(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    urlPattern.test(part) ? (
      <a
        key={i}
        onClick={(e) => { e.preventDefault(); shellBridge.open(part); }}
        className="underline text-amber-800 hover:text-amber-900 cursor-pointer break-all"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

/** Shared tool details list */
function ToolDetailsList({ tools }: { tools: { name: string; description?: string }[] }) {
  return (
    <div className="mt-1.5 ml-5 space-y-1">
      {tools.map((tool) => (
        <div key={tool.name} className="flex items-start gap-2 py-1 px-2 rounded bg-neutral-50">
          <Wrench className="h-3 w-3 text-neutral-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <span className="text-xs font-medium text-neutral-700">{tool.name}</span>
            {tool.description && (
              <p className="text-[11px] text-neutral-500 truncate">{tool.description}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface MCPSectionProps {
  showAddForm?: boolean;
  onAddFormChange?: (open: boolean) => void;
}

export default function MCPSection({ showAddForm: externalShowAddForm, onAddFormChange }: MCPSectionProps = {}) {
  const toolboxSearchQuery = useSettingsStore((s) => s.toolboxSearchQuery);
  const servers = useMCPStore((s) => s.servers);
  const addServer = useMCPStore((s) => s.addServer);
  const removeServer = useMCPStore((s) => s.removeServer);
  const connectServer = useMCPStore((s) => s.connectServer);
  const disconnectServer = useMCPStore((s) => s.disconnectServer);
  const { t } = useI18n();

  const mcpServers = useMemo(() => Object.values(servers), [servers]);

  const [activeSubTab, setActiveSubTab] = useState<MCPSubTab>('connected');

  // Connection UI state
  const [connectingServer, setConnectingServer] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  // Tool list expansion state
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const toggleExpanded = (name: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Test connection state
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  // Server logs viewer
  const [viewingLogs, setViewingLogs] = useState<string | null>(null);

  // New server form - use external prop if provided, otherwise internal state
  const [internalShowAddForm, setInternalShowAddForm] = useState(false);
  const showAddForm = externalShowAddForm ?? internalShowAddForm;
  const setShowAddForm = (open: boolean) => {
    onAddFormChange?.(open);
    setInternalShowAddForm(open);
  };

  const [newServerName, setNewServerName] = useState('');
  const [newTransportType, setNewTransportType] = useState<'stdio' | 'http'>('stdio');
  const [newServerCommand, setNewServerCommand] = useState('');
  const [newServerArgs, setNewServerArgs] = useState('');
  const [newServerUrl, setNewServerUrl] = useState('');
  const [newServerHeaders, setNewServerHeaders] = useState('');

  // Template installation
  const [installingTemplate, setInstallingTemplate] = useState<string | null>(null);
  const [templateArgs, setTemplateArgs] = useState<Record<string, string>>({});
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);

  // Filter templates by search
  const filteredTemplates = mcpTemplates.filter((t) => {
    if (!toolboxSearchQuery) return true;
    const lower = toolboxSearchQuery.toLowerCase();
    return (
      t.name.toLowerCase().includes(lower) ||
      t.description.toLowerCase().includes(lower)
    );
  });

  // Add custom server
  const handleAddServer = async () => {
    if (!newServerName.trim()) return;

    const config: MCPServerConfig = {
      name: newServerName.trim(),
      transport: newTransportType,
      enabled: true,
    };

    if (newTransportType === 'stdio') {
      if (!newServerCommand.trim()) return;
      config.command = newServerCommand.trim();
      config.args = newServerArgs.trim() ? parseArgs(newServerArgs.trim()) : [];
    } else {
      if (!newServerUrl.trim()) return;
      config.url = newServerUrl.trim();
      if (newServerHeaders.trim()) {
        try {
          config.headers = JSON.parse(newServerHeaders.trim());
        } catch {
          // ignore invalid JSON
        }
      }
    }

    addServer(config);
    setNewServerName('');
    setNewTransportType('stdio');
    setNewServerCommand('');
    setNewServerArgs('');
    setNewServerUrl('');
    setNewServerHeaders('');
    setShowAddForm(false);

    // Connect in background with error feedback
    setConnectingServer(config.name);
    setServerErrors((prev) => { const next = { ...prev }; delete next[config.name]; return next; });
    try {
      await connectServer(config.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setServerErrors((prev) => ({ ...prev, [config.name]: msg }));
    } finally {
      setConnectingServer(null);
    }
  };

  // Escape key to close add form modal
  useEffect(() => {
    if (!showAddForm) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowAddForm(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setShowAddForm is a stable wrapper over setState
  }, [showAddForm]);

  const handleCloseAddForm = () => {
    setShowAddForm(false);
    setNewServerName('');
    setNewTransportType('stdio');
    setNewServerCommand('');
    setNewServerArgs('');
    setNewServerUrl('');
    setNewServerHeaders('');
  };

  // Install from template
  const handleInstallTemplate = async (template: typeof mcpTemplates[0]) => {
    setInstallingTemplate(template.id);

    try {
      let config: MCPServerConfig;

      if (template.transport === 'http' && template.url) {
        // HTTP transport template
        config = {
          name: template.name,
          url: template.url,
          enabled: true,
        };
      } else {
        // Stdio transport template
        const args = [...(template.defaultArgs ?? [])];
        if (template.configurableArgs) {
          for (const configArg of template.configurableArgs) {
            const value = templateArgs[`${template.id}-${configArg.index}`];
            if (value) {
              args[configArg.index] = value;
            }
          }
        }

        // Collect env vars from requiredEnvVars inputs
        const env: Record<string, string> = {};
        if (template.requiredEnvVars) {
          for (const envVar of template.requiredEnvVars) {
            const value = templateArgs[`${template.id}-env-${envVar.name}`] || envVar.defaultValue;
            if (value) {
              env[envVar.name] = value;
            }
          }
        }

        config = {
          name: template.name,
          command: template.command ?? 'npx',
          args,
          env: Object.keys(env).length > 0 ? env : undefined,
          enabled: true,
          timeout: template.defaultTimeout,
        };
      }

      addServer(config);

      try {
        await connectServer(config.name);
      } catch (err) {
        console.error('Failed to connect MCP server:', err);
      }
    } finally {
      setInstallingTemplate(null);
      setTemplateArgs({});
    }
  };

  // Remove server
  const handleRemoveServer = (name: string) => {
    removeServer(name);
  };

  // Toggle server connection
  const handleToggleConnection = async (entry: MCPServerEntry) => {
    const name = entry.config.name;
    setConnectingServer(name);
    setServerErrors((prev) => { const next = { ...prev }; delete next[name]; return next; });
    try {
      if (entry.status === 'connected') {
        await disconnectServer(name);
      } else {
        await connectServer(name);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setServerErrors((prev) => ({ ...prev, [name]: msg }));
    } finally {
      setConnectingServer(null);
    }
  };

  // Test connection
  const handleTestConnection = async (entry: MCPServerEntry) => {
    const name = entry.config.name;
    setTestingServer(name);
    setTestResults((prev) => { const next = { ...prev }; delete next[name]; return next; });
    try {
      const result = await mcpManager.testConnection(entry.config);
      const message = result.success
        ? `${t.toolbox.testSuccess} (${result.toolCount ?? 0} tools)`
        : (result.error ?? t.toolbox.testFailed);
      setTestResults((prev) => ({ ...prev, [name]: { success: result.success, message } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResults((prev) => ({ ...prev, [name]: { success: false, message: msg } }));
    } finally {
      setTestingServer(null);
    }
  };

  const installedNames = useMemo(() => new Set(mcpServers.map((s) => s.config.name)), [mcpServers]);
  const templateNames = useMemo(() => new Set(mcpTemplates.map((t) => t.name)), []);
  const customServers = useMemo(() => mcpServers.filter((s) => !templateNames.has(s.config.name)), [mcpServers, templateNames]);
  const connectedServers = useMemo(() => mcpServers.filter((s) => s.status === 'connected'), [mcpServers]);

  const subTabs = [
    { id: 'connected', label: t.toolbox.tabConnected, count: connectedServers.length },
    { id: 'configured', label: t.toolbox.tabCustom, count: customServers.length },
    { id: 'recommended', label: t.toolbox.tabRecommended, count: filteredTemplates.length },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-tab bar */}
      <div className="shrink-0 px-4 pt-4 pb-2">
        <SubTabBar
          tabs={subTabs}
          activeTab={activeSubTab}
          onChange={(id) => setActiveSubTab(id as MCPSubTab)}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Connected tab: only connected servers with tools visible */}
        {activeSubTab === 'connected' && (
          <>
            {connectedServers.length === 0 ? (
              <div className="text-sm text-neutral-400 py-8 text-center">{t.toolbox.noServersConnected}</div>
            ) : (
              <div className="space-y-2">
                {connectedServers.map((entry) => {
                  const { config, tools } = entry;
                  const toolDetails = tools as { name: string; description?: string }[];
                  const toolsExpanded = expandedTools.has(config.name);
                  return (
                    <div key={config.name}>
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-white border border-neutral-200/60">
                        <div className="h-2 w-2 rounded-full shrink-0 bg-green-500" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-neutral-900">{config.name}</span>
                            <span className="text-[10px] text-green-600">{t.toolbox.connected}</span>
                            {toolDetails.length > 0 && (
                              <button
                                onClick={() => toggleExpanded(config.name)}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-100 hover:bg-neutral-200 transition-colors"
                              >
                                <Wrench className="h-3 w-3 text-neutral-500" />
                                <span className="text-[10px] font-medium text-neutral-600">{toolDetails.length}</span>
                                {toolsExpanded
                                  ? <ChevronDown className="h-3 w-3 text-neutral-400" />
                                  : <ChevronRight className="h-3 w-3 text-neutral-400" />}
                              </button>
                            )}
                          </div>
                          <p className="text-xs text-neutral-500 mt-0.5 truncate font-mono">
                            {config.url ? config.url : `${config.command} ${config.args?.join(' ') ?? ''}`}
                          </p>
                        </div>
                      </div>
                      {toolsExpanded && toolDetails.length > 0 && (
                        <ToolDetailsList tools={toolDetails} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Configured tab: servers list + add form + AI setup */}
        {activeSubTab === 'configured' && (
          <>
            {customServers.length === 0 ? (
              <div className="text-sm text-neutral-400 py-8 text-center">{t.toolbox.noServersConfigured}</div>
            ) : (
              <div className="space-y-2">
                {customServers.map((entry) => {
                  const { config, status, tools } = entry;
                  const isConnected = status === 'connected';
                  const isReconnecting = status === 'reconnecting';
                  const isConnecting = connectingServer === config.name || status === 'connecting' || isReconnecting;
                  const error = serverErrors[config.name] || (status === 'error' ? entry.error : undefined);
                  const isTesting = testingServer === config.name;
                  const testResult = testResults[config.name];
                  const toolsExpanded = expandedTools.has(config.name);
                  const toolDetails = tools as { name: string; description?: string }[];

                  return (
                    <div key={config.name}>
                      <div
                        className={cn(
                          'group flex items-center gap-3 p-3 rounded-lg bg-white border',
                          error ? 'border-red-200' : 'border-neutral-200/60'
                        )}
                      >
                        <div
                          className={cn(
                            'h-2 w-2 rounded-full shrink-0',
                            isReconnecting ? 'bg-orange-400 animate-pulse' :
                            isConnecting ? 'bg-amber-400 animate-pulse' :
                            isConnected ? 'bg-green-500' :
                            status === 'error' ? 'bg-red-400' : 'bg-neutral-300'
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-neutral-900">{config.name}</span>
                            <span className="text-[10px] text-neutral-400">
                              {isReconnecting ? t.toolbox.reconnecting :
                               isConnecting ? t.toolbox.connecting :
                               isConnected ? t.toolbox.connected : t.toolbox.disconnected}
                            </span>
                            {/* Tool count badge */}
                            {isConnected && toolDetails.length > 0 && (
                              <button
                                onClick={() => toggleExpanded(config.name)}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-100 hover:bg-neutral-200 transition-colors"
                              >
                                <Wrench className="h-3 w-3 text-neutral-500" />
                                <span className="text-[10px] font-medium text-neutral-600">{toolDetails.length}</span>
                                {toolsExpanded
                                  ? <ChevronDown className="h-3 w-3 text-neutral-400" />
                                  : <ChevronRight className="h-3 w-3 text-neutral-400" />}
                              </button>
                            )}
                          </div>
                          <p className="text-xs text-neutral-500 mt-0.5 truncate font-mono">
                            {config.url ? config.url : `${config.command} ${config.args?.join(' ') ?? ''}`}
                          </p>
                        </div>
                        {/* View logs button */}
                        <button
                          onClick={() => setViewingLogs(viewingLogs === config.name ? null : config.name)}
                          className="shrink-0 p-1.5 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                          title={t.toolbox.viewLogs}
                        >
                          <ScrollText className="h-4 w-4" />
                        </button>
                        {/* Test connection button */}
                        <button
                          onClick={() => handleTestConnection(entry)}
                          disabled={isTesting || isConnecting}
                          className="shrink-0 p-1.5 text-neutral-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                          title={t.toolbox.testConnection}
                        >
                          {isTesting
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Zap className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => handleToggleConnection(entry)}
                          disabled={isConnecting}
                          className={cn(
                            'shrink-0 p-1.5 rounded transition-colors',
                            isConnecting
                              ? 'text-amber-500 cursor-wait'
                              : isConnected
                                ? 'text-green-600 hover:text-green-700 hover:bg-green-50'
                                : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50'
                          )}
                          title={isConnecting ? t.toolbox.connecting : isConnected ? t.toolbox.disconnect : t.toolbox.connect}
                        >
                          {isConnecting
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : isConnected ? <PlugZap className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => handleRemoveServer(config.name)}
                          className="shrink-0 p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      {/* Error message */}
                      {error && (
                        <p className="mt-1 px-3 text-xs text-red-500 break-words">{error}</p>
                      )}
                      {/* Test result */}
                      {testResult && (
                        <div className={cn(
                          'mt-1 px-3 py-1.5 text-xs rounded-md flex items-center gap-1.5',
                          testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                        )}>
                          {testResult.success ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                          {testResult.message}
                        </div>
                      )}
                      {/* Expanded tool list */}
                      {toolsExpanded && toolDetails.length > 0 && (
                        <ToolDetailsList tools={toolDetails} />
                      )}
                      {/* Server logs */}
                      {viewingLogs === config.name && (
                        <ServerLogsPanel serverName={config.name} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          </>
        )}

        {/* Recommended tab: MCP templates */}
        {activeSubTab === 'recommended' && (
          <>
            {filteredTemplates.length === 0 ? (
              <div className="text-sm text-neutral-400 py-8 text-center">{t.toolbox.noSkillsFound}</div>
            ) : (
              <div className="space-y-2">
                {filteredTemplates.map((template) => {
                  const isInstalled = installedNames.has(template.name);
                  const isInstalling = installingTemplate === template.id;
                  const isHttp = template.transport === 'http';
                  const hasConfigurableArgs = template.configurableArgs && template.configurableArgs.length > 0;
                  const hasEnvVars = template.requiredEnvVars && template.requiredEnvVars.length > 0;
                  const hasSetupHint = !!template.setupHint;
                  const hasInputs = hasConfigurableArgs || hasEnvVars || hasSetupHint;
                  const isExpanded = expandedTemplate === template.id;

                  // Get server entry for installed templates
                  const serverEntry = isInstalled ? servers[template.name] : undefined;
                  const serverStatus = serverEntry?.status;
                  const isConnected = serverStatus === 'connected';
                  const isReconnecting = serverStatus === 'reconnecting';
                  const isConnecting = connectingServer === template.name || serverStatus === 'connecting' || isReconnecting;
                  const error = serverEntry ? (serverErrors[template.name] || (serverStatus === 'error' ? serverEntry.error : undefined)) : undefined;
                  const isTesting = testingServer === template.name;
                  const testResult = testResults[template.name];
                  const toolDetails = (serverEntry?.tools ?? []) as { name: string; description?: string }[];
                  const toolsExpanded = expandedTools.has(template.name);

                  return (
                    <div
                      key={template.id}
                      className={cn(
                        'p-3 rounded-lg border border-neutral-200/60 transition-colors',
                        !isInstalled && 'hover:border-neutral-300'
                      )}
                    >
                      <div className="flex items-start gap-3">
                        {/* Status dot for installed servers */}
                        {isInstalled && (
                          <div className={cn(
                            'h-2 w-2 rounded-full shrink-0 mt-1.5',
                            isReconnecting ? 'bg-orange-400 animate-pulse' :
                            isConnecting ? 'bg-amber-400 animate-pulse' :
                            isConnected ? 'bg-green-500' :
                            serverStatus === 'error' ? 'bg-red-400' : 'bg-neutral-300'
                          )} />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-neutral-900">{template.name}</span>
                            {isHttp && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">HTTP</span>
                            )}
                            {isInstalled && (
                              <span className="text-[10px] text-neutral-400">
                                {isReconnecting ? t.toolbox.reconnecting :
                                 isConnecting ? t.toolbox.connecting :
                                 isConnected ? t.toolbox.connected : t.toolbox.disconnected}
                              </span>
                            )}
                            {/* Tool count badge for installed & connected */}
                            {isConnected && toolDetails.length > 0 && (
                              <button
                                onClick={() => toggleExpanded(template.name)}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-100 hover:bg-neutral-200 transition-colors"
                              >
                                <Wrench className="h-3 w-3 text-neutral-500" />
                                <span className="text-[10px] font-medium text-neutral-600">{toolDetails.length}</span>
                                {toolsExpanded
                                  ? <ChevronDown className="h-3 w-3 text-neutral-400" />
                                  : <ChevronRight className="h-3 w-3 text-neutral-400" />}
                              </button>
                            )}
                          </div>
                          <p className="text-xs text-neutral-500 mt-1">{template.description}</p>
                        </div>
                        {isInstalled ? (
                          <div className="shrink-0 flex items-center gap-1">
                            {/* View logs */}
                            <button
                              onClick={() => setViewingLogs(viewingLogs === template.name ? null : template.name)}
                              className="p-1.5 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50 rounded transition-colors"
                              title={t.toolbox.viewLogs}
                            >
                              <ScrollText className="h-4 w-4" />
                            </button>
                            {/* Test connection */}
                            <button
                              onClick={() => serverEntry && handleTestConnection(serverEntry)}
                              disabled={isTesting || isConnecting}
                              className="p-1.5 text-neutral-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                              title={t.toolbox.testConnection}
                            >
                              {isTesting
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Zap className="h-4 w-4" />}
                            </button>
                            {/* Connect / Disconnect */}
                            <button
                              onClick={() => serverEntry && handleToggleConnection(serverEntry)}
                              disabled={isConnecting}
                              className={cn(
                                'p-1.5 rounded transition-colors',
                                isConnecting
                                  ? 'text-amber-500 cursor-wait'
                                  : isConnected
                                    ? 'text-green-600 hover:text-green-700 hover:bg-green-50'
                                    : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50'
                              )}
                              title={isConnecting ? t.toolbox.connecting : isConnected ? t.toolbox.disconnect : t.toolbox.connect}
                            >
                              {isConnecting
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : isConnected ? <PlugZap className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
                            </button>
                            {/* Delete */}
                            <button
                              onClick={() => handleRemoveServer(template.name)}
                              className="p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              if (hasInputs) {
                                setExpandedTemplate(isExpanded ? null : template.id);
                              } else {
                                handleInstallTemplate(template);
                              }
                            }}
                            disabled={isInstalling}
                            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#d97757] text-white hover:bg-[#c5664a] disabled:opacity-50"
                          >
                            {isInstalling ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Plus className="h-3.5 w-3.5" />
                            )}
                            {t.toolbox.install}
                          </button>
                        )}
                      </div>

                      {/* Error message for installed servers */}
                      {isInstalled && error && (
                        <p className="mt-1 px-3 text-xs text-red-500 break-words">{error}</p>
                      )}
                      {/* Test result */}
                      {isInstalled && testResult && (
                        <div className={cn(
                          'mt-1 px-3 py-1.5 text-xs rounded-md flex items-center gap-1.5',
                          testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                        )}>
                          {testResult.success ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                          {testResult.message}
                        </div>
                      )}
                      {/* Expanded tool list */}
                      {toolsExpanded && toolDetails.length > 0 && (
                        <ToolDetailsList tools={toolDetails} />
                      )}
                      {/* Server logs */}
                      {isInstalled && viewingLogs === template.name && (
                        <ServerLogsPanel serverName={template.name} />
                      )}

                      {/* Configuration panel — only shown when expanded */}
                      {isExpanded && hasInputs && !isInstalled && (
                        <div className="mt-3 pt-3 border-t border-neutral-100 space-y-2">
                          {template.setupHint && (
                            <div className="p-2.5 rounded-md bg-amber-50 border border-amber-200/60">
                              <p className="text-xs text-amber-700 leading-relaxed whitespace-pre-wrap break-words">
                                {renderSetupHint(template.setupHint)}
                              </p>
                            </div>
                          )}
                          {template.configurableArgs?.map((arg) => (
                            <input
                              key={arg.index}
                              type="text"
                              placeholder={arg.placeholder}
                              value={templateArgs[`${template.id}-${arg.index}`] || ''}
                              onChange={(e) =>
                                setTemplateArgs((prev) => ({
                                  ...prev,
                                  [`${template.id}-${arg.index}`]: e.target.value,
                                }))
                              }
                              className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757]"
                            />
                          ))}
                          {template.requiredEnvVars?.map((envVar) => (
                            <div key={envVar.name}>
                              <label className="block text-xs text-neutral-600 mb-1">{envVar.label}</label>
                              <input
                                type={envVar.secret !== false ? "password" : "text"}
                                placeholder={envVar.placeholder}
                                value={templateArgs[`${template.id}-env-${envVar.name}`] || envVar.defaultValue || ''}
                                onChange={(e) =>
                                  setTemplateArgs((prev) => ({
                                    ...prev,
                                    [`${template.id}-env-${envVar.name}`]: e.target.value,
                                  }))
                                }
                                className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757] font-mono"
                              />
                              {envVar.description && (
                                <p className="text-[11px] text-neutral-400 mt-0.5">{envVar.description}</p>
                              )}
                            </div>
                          ))}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleInstallTemplate(template)}
                              disabled={isInstalling}
                              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-[#d97757] text-white hover:bg-[#c5664a] disabled:opacity-50"
                            >
                              {isInstalling ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Plus className="h-4 w-4" />
                              )}
                              {t.toolbox.installAndConnect}
                            </button>
                            <button
                              onClick={() => {
                                setExpandedTemplate(null);
                                // Clear this template's args
                                setTemplateArgs((prev) => {
                                  const next = { ...prev };
                                  Object.keys(next).forEach((k) => {
                                    if (k.startsWith(template.id)) delete next[k];
                                  });
                                  return next;
                                });
                              }}
                              className="px-3 py-2 rounded-md text-sm text-neutral-600 hover:bg-neutral-100"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Server Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleCloseAddForm}>
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5 text-[#d97757]" />
                <h2 className="text-base font-semibold text-neutral-900">{t.toolbox.addCustomServer}</h2>
              </div>
              <button
                onClick={handleCloseAddForm}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">{t.toolbox.serverName}</label>
                <input
                  type="text"
                  placeholder={t.toolbox.serverName}
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757]"
                />
              </div>

              {/* Transport type toggle */}
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">{t.toolbox.transportType}</label>
                <div className="flex gap-1 p-0.5 bg-neutral-100 rounded-md">
                  <button
                    onClick={() => setNewTransportType('stdio')}
                    className={cn(
                      'flex-1 py-1.5 text-xs font-medium rounded transition-colors',
                      newTransportType === 'stdio'
                        ? 'bg-white text-neutral-900 shadow-sm'
                        : 'text-neutral-500 hover:text-neutral-700'
                    )}
                  >
                    {t.toolbox.transportStdio}
                  </button>
                  <button
                    onClick={() => setNewTransportType('http')}
                    className={cn(
                      'flex-1 py-1.5 text-xs font-medium rounded transition-colors',
                      newTransportType === 'http'
                        ? 'bg-white text-neutral-900 shadow-sm'
                        : 'text-neutral-500 hover:text-neutral-700'
                    )}
                  >
                    {t.toolbox.transportHttp}
                  </button>
                </div>
              </div>

              {/* Stdio fields */}
              {newTransportType === 'stdio' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">{t.toolbox.serverCommand}</label>
                    <input
                      type="text"
                      placeholder={t.toolbox.serverCommand}
                      value={newServerCommand}
                      onChange={(e) => setNewServerCommand(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">{t.toolbox.serverArgs}</label>
                    <input
                      type="text"
                      placeholder={t.toolbox.serverArgs}
                      value={newServerArgs}
                      onChange={(e) => setNewServerArgs(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757]"
                    />
                  </div>
                </>
              )}

              {/* HTTP fields */}
              {newTransportType === 'http' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">URL</label>
                    <input
                      type="text"
                      placeholder={t.toolbox.serverUrlPlaceholder}
                      value={newServerUrl}
                      onChange={(e) => setNewServerUrl(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">Headers (JSON)</label>
                    <input
                      type="text"
                      placeholder={t.toolbox.serverHeadersPlaceholder}
                      value={newServerHeaders}
                      onChange={(e) => setNewServerHeaders(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757] font-mono"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-100">
              <button
                onClick={handleCloseAddForm}
                className="px-4 py-1.5 rounded-lg text-sm font-medium text-neutral-600 hover:bg-neutral-100 transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleAddServer}
                disabled={
                  !newServerName.trim() ||
                  (newTransportType === 'stdio' && !newServerCommand.trim()) ||
                  (newTransportType === 'http' && !newServerUrl.trim())
                }
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-[#d97757] text-white hover:bg-[#c5664a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
                {t.toolbox.add}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Server Logs Panel ---

function ServerLogsPanel({ serverName }: { serverName: string }) {
  const { t } = useI18n();
  const [logs, setLogs] = useState<MCPLogEntry[]>(() => mcpManager.getServerLogs(serverName));

  // Subscribe to mcpManager changes to keep logs fresh
  useEffect(() => {
    const update = () => setLogs([...mcpManager.getServerLogs(serverName)]);
    const unsubscribe = mcpManager.subscribe(update);
    // Also refresh on an interval for stderr logs that don't trigger notify
    const timer = setInterval(update, 2000);
    return () => { unsubscribe(); clearInterval(timer); };
  }, [serverName]);

  if (logs.length === 0) {
    return (
      <div className="mt-2 px-3 py-2 text-[11px] text-neutral-400 bg-neutral-50 rounded border border-neutral-200">
        {t.toolbox.noLogs}
      </div>
    );
  }

  return (
    <div className="mt-2 max-h-[200px] overflow-y-auto rounded border border-neutral-200 bg-neutral-900 p-2">
      {logs.map((log, i) => (
        <div key={i} className="flex gap-2 text-[11px] font-mono leading-4">
          <span className="text-neutral-500 shrink-0">
            {new Date(log.timestamp).toLocaleTimeString()}
          </span>
          <span className={cn(
            log.level === 'error' ? 'text-red-400' :
            log.level === 'warn' ? 'text-amber-400' : 'text-neutral-300'
          )}>
            {log.message}
          </span>
        </div>
      ))}
    </div>
  );
}
