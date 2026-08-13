import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Database,
  Loader2,
  PlayCircle,
  Pencil,
  Plus,
  Server,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchMcpPresets,
  importMcpConfig,
  runMcpPresetAction,
  saveCustomMcpServer,
  updateMcpServerTools,
} from '@/core/api';
import { getNanobotStatus, getNanobotToken, refreshNanobotAuth } from '@/core/nanobotClient';
import type { McpPresetInfo, McpPresetsPayload } from '@/core/types';
import { notifyMcpPresetsChanged } from '@/lib/mcp-preset-events';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';
import { useI18n } from '@/i18n';

type MCPSubTab = 'enabled' | 'all' | 'custom';
type McpAction = 'enable' | 'update' | 'remove' | 'test';
type CustomMcpTransport = 'stdio' | 'streamableHttp' | 'sse';

interface MCPSectionProps {
  showAddForm?: boolean;
  onAddFormChange?: (open: boolean) => void;
}

const DEFAULT_CUSTOM_FORM = {
  name: '',
  transport: 'stdio' as CustomMcpTransport,
  command: 'npx',
  url: '',
  args: '',
  env: '',
  headers: '',
  toolTimeout: '',
};

async function nanobotAuth(): Promise<{ token: string; base: string }> {
  const status = await getNanobotStatus();
  if (status.ready) {
    const token = getNanobotToken();
    if (token) return { token, base: `http://127.0.0.1:${status.port}` };
  }
  const refreshed = await refreshNanobotAuth();
  return { token: refreshed.token, base: refreshed.baseUrl };
}

function statusLabel(status: string, isEnglish: boolean): string {
  if (isEnglish) {
    if (status === 'configured') return 'Configured';
    if (status === 'missing_credentials') return 'Credentials required';
    if (status === 'missing_dependency') return 'Dependency required';
    if (status === 'coming_soon') return 'Coming soon';
    return 'Disabled';
  }
  if (status === 'configured') return '已配置';
  if (status === 'missing_credentials') return '缺少密钥';
  if (status === 'missing_dependency') return '缺少依赖';
  if (status === 'coming_soon') return '暂不可用';
  return '未启用';
}

function transportLabel(transport: string): string {
  if (transport === 'streamableHttp') return 'HTTP';
  return transport || 'mcp';
}

function presetReady(preset: McpPresetInfo): boolean {
  return preset.installed && preset.configured;
}

function presetSearchText(preset: McpPresetInfo): string {
  return [
    preset.name,
    preset.display_name,
    preset.category,
    preset.description,
    preset.requires,
    preset.note,
    preset.transport,
    preset.connection_summary,
  ].join(' ').toLowerCase();
}

function parseMaybeJson(value: string, fallback: unknown): unknown {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return JSON.parse(trimmed);
}

export default function MCPSection({ showAddForm: externalShowAddForm, onAddFormChange }: MCPSectionProps = {}) {
  const { locale } = useI18n();
  const isEnglish = locale === 'en-US';
  const toolboxSearchQuery = useSettingsStore((s) => s.toolboxSearchQuery);
  const [payload, setPayload] = useState<McpPresetsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<MCPSubTab>('enabled');
  const [expandedSetup, setExpandedSetup] = useState<string | null>(null);
  const [expandedTools, setExpandedTools] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, Record<string, string>>>({});
  const [customForm, setCustomForm] = useState(DEFAULT_CUSTOM_FORM);
  const [importText, setImportText] = useState('');
  const [customMode, setCustomMode] = useState<'custom' | 'import'>('custom');

  const [internalShowAddForm, setInternalShowAddForm] = useState(false);
  const showAddForm = externalShowAddForm ?? internalShowAddForm;
  const setShowAddForm = (open: boolean) => {
    onAddFormChange?.(open);
    setInternalShowAddForm(open);
    if (open) setActiveSubTab('custom');
  };

  const loadPresets = async () => {
    setLoading(true);
    setError(null);
    try {
      const { token, base } = await nanobotAuth();
      const next = await fetchMcpPresets(token, base);
      setPayload(next);
      notifyMcpPresetsChanged(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPresets();
  }, []);

  useEffect(() => {
    if (externalShowAddForm) {
      setActiveSubTab('custom');
      setCustomMode('custom');
    }
  }, [externalShowAddForm]);

  const presets = payload?.presets ?? [];
  const normalizedQuery = (toolboxSearchQuery || '').trim().toLowerCase();
  const filteredPresets = useMemo(() => {
    return presets
      .filter((preset) => {
        if (activeSubTab === 'enabled') return presetReady(preset);
        if (activeSubTab === 'custom') return false;
        return true;
      })
      .filter((preset) => !normalizedQuery || presetSearchText(preset).includes(normalizedQuery))
      .sort((left, right) => Number(!presetReady(left)) - Number(!presetReady(right)) || left.display_name.localeCompare(right.display_name));
  }, [activeSubTab, normalizedQuery, presets]);

  const enabledCount = presets.filter(presetReady).length;
  const subTabs = [
    { id: 'enabled' as const, label: isEnglish ? 'Enabled' : '已启用', count: enabledCount },
    { id: 'all' as const, label: isEnglish ? 'All' : '全部', count: presets.length },
    { id: 'custom' as const, label: isEnglish ? 'Custom' : '自定义', count: 0 },
  ];

  const updatePayload = (next: McpPresetsPayload) => {
    setPayload(next);
    notifyMcpPresetsChanged(next);
    if (next.requires_restart) {
      setMessage(isEnglish ? 'MCP configuration updated. Restart the app to connect the new tools.' : 'MCP 配置已更新，需要重启后连接新工具。');
    } else if (next.hot_reload?.message) {
      setMessage(next.hot_reload.message);
    }
  };

  const runAction = async (action: McpAction, preset: McpPresetInfo) => {
    const values = fieldValues[preset.name] ?? {};
    const key = `${action}:${preset.name}`;
    setActionKey(key);
    setError(null);
    setMessage(null);
    try {
      const { token, base } = await nanobotAuth();
      const next = await runMcpPresetAction(token, action, preset.name, values, base);
      updatePayload(next);
      const last = next.last_action;
      if (last?.message) {
        if (last.ok) setMessage(last.message);
        else setError(last.message);
      }
      if (action === 'enable' || action === 'update') {
        // Password values must not remain in renderer state after saving.
        setFieldValues((current) => ({ ...current, [preset.name]: {} }));
      }
      if (action === 'enable') setExpandedSetup(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionKey(null);
    }
  };

  const saveCustom = async () => {
    const values: Record<string, string> = {
      name: customForm.name.trim(),
      transport: customForm.transport,
      command: customForm.command.trim(),
      url: customForm.url.trim(),
      args: customForm.args.trim(),
      env: customForm.env.trim(),
      headers: customForm.headers.trim(),
      tool_timeout: customForm.toolTimeout.trim(),
    };
    setActionKey('custom');
    setError(null);
    setMessage(null);
    try {
      const { token, base } = await nanobotAuth();
      parseMaybeJson(values.args || '[]', []);
      parseMaybeJson(values.env || '{}', {});
      parseMaybeJson(values.headers || '{}', {});
      const next = await saveCustomMcpServer(token, values, base);
      updatePayload(next);
      setCustomForm(DEFAULT_CUSTOM_FORM);
      setShowAddForm(false);
      setActiveSubTab('enabled');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionKey(null);
    }
  };

  const importConfig = async () => {
    setActionKey('import');
    setError(null);
    setMessage(null);
    try {
      JSON.parse(importText);
      const { token, base } = await nanobotAuth();
      const next = await importMcpConfig(token, importText, base);
      updatePayload(next);
      setImportText('');
      setShowAddForm(false);
      setActiveSubTab('enabled');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionKey(null);
    }
  };

  const updateTools = async (preset: McpPresetInfo, enabledTools: string[]) => {
    setActionKey(`tools:${preset.name}`);
    setError(null);
    setMessage(null);
    try {
      const { token, base } = await nanobotAuth();
      const next = await updateMcpServerTools(token, preset.name, enabledTools, base);
      updatePayload(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionKey(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 px-4 pt-4 pb-2">
        <div className="flex rounded-xl bg-[#f3f2ee] p-1">
          {subTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={cn(
                'flex-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors',
                activeSubTab === tab.id ? 'bg-white text-[#29261b] shadow-sm' : 'text-[#656358] hover:text-[#29261b]',
              )}
            >
              {tab.label}
              {tab.count ? <span className="ml-1 text-[11px] text-[#888579]">{tab.count}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {(error || message) && (
          <div
            className={cn(
              'mb-3 flex items-start justify-between gap-3 rounded-xl border px-3 py-2 text-[12px]',
              error ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800',
            )}
          >
            <span className="min-w-0 break-words">{error || message}</span>
            <button type="button" onClick={() => { setError(null); setMessage(null); }} className="shrink-0 rounded p-0.5 hover:bg-black/5">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {activeSubTab === 'custom' || showAddForm ? (
          <CustomMcpPanel
            mode={customMode}
            setMode={setCustomMode}
            form={customForm}
            setForm={setCustomForm}
            importText={importText}
            setImportText={setImportText}
            busy={actionKey === 'custom' || actionKey === 'import'}
            onSave={saveCustom}
            onImport={importConfig}
            isEnglish={isEnglish}
          />
        ) : loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-[#656358]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {isEnglish ? 'Loading MCP presets...' : '正在加载 MCP presets...'}
          </div>
        ) : filteredPresets.length === 0 ? (
          <div className="py-10 text-center text-sm text-[#888579]">{isEnglish ? 'No matching MCP services' : '没有匹配的 MCP 服务'}</div>
        ) : (
          <div className="space-y-2">
            {filteredPresets.map((preset) => (
              <McpPresetRow
                key={preset.name}
                preset={preset}
                values={fieldValues[preset.name] ?? {}}
                onValueChange={(field, value) => {
                  setFieldValues((current) => ({
                    ...current,
                    [preset.name]: { ...(current[preset.name] ?? {}), [field]: value },
                  }));
                }}
                setupOpen={expandedSetup === preset.name}
                toolsOpen={expandedTools === preset.name}
                setSetupOpen={(open) => setExpandedSetup(open ? preset.name : null)}
                setToolsOpen={(open) => setExpandedTools(open ? preset.name : null)}
                actionKey={actionKey}
                onAction={runAction}
                onToolsChange={(tools) => updateTools(preset, tools)}
                isEnglish={isEnglish}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function McpPresetRow({
  preset,
  values,
  onValueChange,
  setupOpen,
  toolsOpen,
  setSetupOpen,
  setToolsOpen,
  actionKey,
  onAction,
  onToolsChange,
  isEnglish,
}: {
  preset: McpPresetInfo;
  values: Record<string, string>;
  onValueChange: (field: string, value: string) => void;
  setupOpen: boolean;
  toolsOpen: boolean;
  setSetupOpen: (open: boolean) => void;
  setToolsOpen: (open: boolean) => void;
  actionKey: string | null;
  onAction: (action: McpAction, preset: McpPresetInfo) => void;
  onToolsChange: (tools: string[]) => void;
  isEnglish: boolean;
}) {
  const ready = presetReady(preset);
  const missingFields = preset.required_fields.filter((field) => field.required && !field.configured);
  const needsSetup = missingFields.length > 0;
  const hasFields = preset.required_fields.length > 0;
  const toolNames = preset.tool_names ?? [];
  const enabledTools = preset.enabled_tools ?? ['*'];
  const allowAll = enabledTools.includes('*');
  const enabledSet = new Set(allowAll ? toolNames : enabledTools);
  const busy = actionKey?.endsWith(`:${preset.name}`) ?? false;
  const enableBusy = actionKey === `enable:${preset.name}`;
  const removeBusy = actionKey === `remove:${preset.name}`;
  const testBusy = actionKey === `test:${preset.name}`;
  const toolsBusy = actionKey === `tools:${preset.name}`;
  const connection = preset.connection;
  const settingValue = (key: string, fallback = '') => values[key] ?? fallback;
  const visibleFields = preset.required_fields;
  const canEnable = preset.install_supported && (
    !needsSetup || missingFields.every((field) => Boolean(values[field.name]?.trim()))
  );
  const description = preset.description || preset.note || preset.requires || preset.connection_summary;

  const enable = () => {
    if ((needsSetup || (preset.installed && !preset.configured && hasFields)) && !setupOpen) {
      setSetupOpen(true);
      return;
    }
    if (!canEnable) return;
    onAction('enable', preset);
  };

  const toggleTool = (toolName: string) => {
    const next = new Set(allowAll ? toolNames : enabledTools);
    if (next.has(toolName)) next.delete(toolName);
    else next.add(toolName);
    const nextValues = Array.from(next);
    onToolsChange(nextValues.length === toolNames.length ? ['*'] : nextValues);
  };

  return (
    <article className="rounded-xl border border-[#e5e2db] bg-white p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
            ready ? 'bg-green-500' : preset.status === 'missing_credentials' ? 'bg-amber-400' : preset.status === 'coming_soon' ? 'bg-neutral-300' : 'bg-[#d5d1c8]',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[#29261b]">{preset.display_name}</h3>
            <span className="rounded-full bg-[#f3f2ee] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#656358]">
              {transportLabel(preset.transport)}
            </span>
            <span className="text-[10px] text-[#888579]">{statusLabel(preset.status, isEnglish)}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#656358]">{description}</p>
          {preset.error ? <p className="mt-1 text-xs text-red-600">{preset.error}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {ready ? (
            <>
              {preset.installed ? (
                <IconButton busy={false} disabled={busy} title={isEnglish ? 'Edit connection settings' : '编辑连接配置'} onClick={() => setSetupOpen(!setupOpen)}>
                  <Pencil className="h-4 w-4" />
                </IconButton>
              ) : null}
              <IconButton busy={testBusy} disabled={busy && !testBusy} title={isEnglish ? 'Test' : '测试'} onClick={() => onAction('test', preset)}>
                <PlayCircle className="h-4 w-4" />
              </IconButton>
              {toolNames.length ? (
                <IconButton busy={toolsBusy} disabled={busy && !toolsBusy} title={isEnglish ? 'Tool scope' : '工具范围'} onClick={() => setToolsOpen(!toolsOpen)}>
                  <SlidersHorizontal className="h-4 w-4" />
                </IconButton>
              ) : null}
              <IconButton busy={removeBusy} disabled={busy && !removeBusy} danger title={isEnglish ? 'Remove' : '移除'} onClick={() => onAction('remove', preset)}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </>
          ) : preset.install_supported ? (
            <IconButton busy={enableBusy} disabled={busy} title={needsSetup ? (isEnglish ? 'Configure and enable' : '配置并启用') : (isEnglish ? 'Enable' : '启用')} onClick={enable}>
              <Plus className="h-4 w-4" />
            </IconButton>
          ) : (
            <IconButton disabled title={isEnglish ? 'Coming soon' : '暂不可用'}>
              <AlertCircle className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      </div>

      {setupOpen && (hasFields || preset.installed) ? (
        <div className="mt-3 rounded-xl border border-[#e8e4dd] bg-[#fbfaf7] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#29261b]">{isEnglish ? 'Connect ' : '连接 '}{preset.display_name}</span>
            <button type="button" onClick={() => setSetupOpen(false)} className="rounded p-1 text-[#888579] hover:bg-[#eeeae2]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid gap-2">
            {visibleFields.map((field) => (
              <label key={field.name}>
                <span className="mb-1 block text-[11px] font-medium text-[#656358]">
                  {field.label}
                  {field.configured ? (
                    <span className="ml-1 text-green-600">
                      {field.credential_source === 'built_in' || field.credential_source === 'environment'
                        ? (isEnglish ? 'Built-in shared key' : '内置通用 Key')
                        : (isEnglish ? 'Personal key' : '个人 Key')}
                    </span>
                  ) : null}
                </span>
                <Input
                  type={field.secret ? 'password' : 'text'}
                  value={values[field.name] ?? ''}
                  onChange={(event) => onValueChange(field.name, event.target.value)}
                  placeholder={field.configured
                    ? (field.credential_source === 'built_in' || field.credential_source === 'environment'
                        ? (isEnglish ? 'Enter a personal key to override the shared key' : '填写个人 Key 可覆盖内置通用 Key')
                        : (isEnglish ? 'Leave blank to keep the current personal key' : '留空表示保持当前个人 Key'))
                    : field.placeholder}
                  className="h-9 rounded-lg bg-white text-[12px]"
                />
              </label>
            ))}
          </div>
          {preset.installed && (
            <div className="mt-3 grid gap-2 border-t border-[#e8e4dd] pt-3">
              <span className="text-[11px] font-semibold text-[#656358]">{isEnglish ? 'Connection settings' : '连接设置'}</span>
              <Select
                value={settingValue('transport', connection?.transport ?? preset.transport)}
                onChange={(value) => onValueChange('transport', value)}
                options={[
                  { value: 'stdio', label: 'stdio' },
                  { value: 'streamableHttp', label: 'HTTP' },
                  { value: 'sse', label: 'SSE' },
                ]}
              />
              {settingValue('transport', connection?.transport ?? preset.transport) === 'stdio' ? (
                <>
                  <Input value={settingValue('command', connection?.command)} onChange={(event) => onValueChange('command', event.target.value)} placeholder={isEnglish ? 'Command, e.g. npx' : '命令，例如 npx'} className="h-9 rounded-lg bg-white text-[12px]" />
                  <Textarea value={settingValue('args', JSON.stringify(connection?.args ?? []))} onChange={(event) => onValueChange('args', event.target.value)} placeholder={isEnglish ? 'Arguments JSON, e.g. ["-y", "server"]' : '参数 JSON，例如 ["-y", "server"]'} className="min-h-[64px] font-mono text-xs" />
                  <Input value={settingValue('cwd', connection?.cwd)} onChange={(event) => onValueChange('cwd', event.target.value)} placeholder={isEnglish ? 'Working directory (optional)' : '工作目录（可选）'} className="h-9 rounded-lg bg-white text-[12px]" />
                </>
              ) : (
                <Input value={settingValue('url', connection?.url)} onChange={(event) => onValueChange('url', event.target.value)} placeholder={isEnglish ? 'MCP endpoint URL' : 'MCP 服务地址'} className="h-9 rounded-lg bg-white text-[12px]" />
              )}
              <div className="grid gap-2 md:grid-cols-2">
                <Textarea value={settingValue('env')} onChange={(event) => onValueChange('env', event.target.value)} placeholder={connection?.has_env ? (isEnglish ? 'Environment JSON (leave blank to keep current values)' : '环境变量 JSON（留空保留原值）') : (isEnglish ? 'Environment JSON (optional)' : '环境变量 JSON（可选）')} className="min-h-[64px] font-mono text-xs" />
                <Textarea value={settingValue('headers')} onChange={(event) => onValueChange('headers', event.target.value)} placeholder={connection?.has_headers ? (isEnglish ? 'Headers JSON (leave blank to keep current values)' : '请求头 JSON（留空保留原值）') : (isEnglish ? 'Headers JSON (optional)' : '请求头 JSON（可选）')} className="min-h-[64px] font-mono text-xs" />
              </div>
              <Input value={settingValue('tool_timeout', String(connection?.tool_timeout ?? ''))} onChange={(event) => onValueChange('tool_timeout', event.target.value)} placeholder={isEnglish ? 'Tool timeout (seconds)' : '工具超时（秒）'} inputMode="numeric" className="h-9 rounded-lg bg-white text-[12px]" />
            </div>
          )}
          <div className="mt-3 flex justify-end">
            <Button size="sm" disabled={ready ? busy : (!canEnable || enableBusy)} onClick={() => onAction(ready ? 'update' : 'enable', preset)} className="h-8 rounded-lg text-xs">
              {enableBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
              {ready ? (isEnglish ? 'Save changes' : '保存修改') : (isEnglish ? 'Save and enable' : '保存并启用')}
            </Button>
          </div>
        </div>
      ) : null}

      {toolsOpen && ready && toolNames.length ? (
        <div className="mt-3 rounded-xl border border-[#e8e4dd] bg-[#fbfaf7] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-[#29261b]">{isEnglish ? 'Tool scope' : '工具范围'}</span>
            <div className="flex gap-1">
              <Button size="sm" variant={allowAll ? 'default' : 'outline'} disabled={toolsBusy} onClick={() => onToolsChange(['*'])} className="h-7 rounded-lg px-2 text-[11px]">{isEnglish ? 'All' : '全部'}</Button>
              <Button size="sm" variant={!allowAll && enabledSet.size === 0 ? 'default' : 'outline'} disabled={toolsBusy} onClick={() => onToolsChange([])} className="h-7 rounded-lg px-2 text-[11px]">{isEnglish ? 'None' : '无'}</Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {toolNames.map((toolName) => {
              const selected = enabledSet.has(toolName);
              return (
                <button
                  key={toolName}
                  type="button"
                  disabled={toolsBusy}
                  onClick={() => toggleTool(toolName)}
                  className={cn(
                    'max-w-full rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors',
                    selected ? 'border-[#d97757]/30 bg-[#d97757]/10 text-[#9b4a2e]' : 'border-[#e5e2db] bg-white text-[#656358]',
                  )}
                >
                  <span className="block max-w-[220px] truncate">{toolName}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function CustomMcpPanel({
  mode,
  setMode,
  form,
  setForm,
  importText,
  setImportText,
  busy,
  onSave,
  onImport,
  isEnglish,
}: {
  mode: 'custom' | 'import';
  setMode: (mode: 'custom' | 'import') => void;
  form: typeof DEFAULT_CUSTOM_FORM;
  setForm: (next: typeof DEFAULT_CUSTOM_FORM) => void;
  importText: string;
  setImportText: (value: string) => void;
  busy: boolean;
  onSave: () => void;
  onImport: () => void;
  isEnglish: boolean;
}) {
  const remote = form.transport !== 'stdio';
  const canSave = Boolean(form.name.trim()) && (remote ? Boolean(form.url.trim()) : Boolean(form.command.trim()));
  const update = <K extends keyof typeof DEFAULT_CUSTOM_FORM>(key: K, value: (typeof DEFAULT_CUSTOM_FORM)[K]) => {
    setForm({ ...form, [key]: value });
  };

  return (
    <section className="rounded-xl border border-[#e5e2db] bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Server className="h-4 w-4 text-[#656358]" />
          <div>
            <h3 className="text-sm font-semibold text-[#29261b]">{isEnglish ? 'More MCP options' : '更多 MCP 选项'}</h3>
            <p className="text-xs text-[#888579]">{isEnglish ? 'Add a custom service or import mcp.json.' : '添加自定义服务，或导入 mcp.json。'}</p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant={mode === 'custom' ? 'default' : 'outline'} onClick={() => setMode('custom')} className="h-8 rounded-lg text-xs">
            <Server className="mr-1.5 h-3.5 w-3.5" />
            {isEnglish ? 'Custom' : '自定义'}
          </Button>
          <Button size="sm" variant={mode === 'import' ? 'default' : 'outline'} onClick={() => setMode('import')} className="h-8 rounded-lg text-xs">
            <Database className="mr-1.5 h-3.5 w-3.5" />
            {isEnglish ? 'Import' : '导入'}
          </Button>
        </div>
      </div>

      {mode === 'custom' ? (
        <div className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[1fr_160px]">
            <Input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder={isEnglish ? 'Service name, e.g. docs' : '服务名，例如 docs'} className="h-9 rounded-lg" />
            <Select
              value={form.transport}
              onChange={(value) => update('transport', value as CustomMcpTransport)}
              options={[
                { value: 'stdio', label: 'stdio' },
                { value: 'streamableHttp', label: 'HTTP' },
                { value: 'sse', label: 'SSE' },
              ]}
            />
          </div>
          {remote ? (
            <Input value={form.url} onChange={(event) => update('url', event.target.value)} placeholder={form.transport === 'sse' ? 'https://example.com/sse' : 'https://example.com/mcp'} className="h-9 rounded-lg" />
          ) : (
            <Input value={form.command} onChange={(event) => update('command', event.target.value)} placeholder="npx" className="h-9 rounded-lg" />
          )}
          {!remote ? (
            <Textarea value={form.args} onChange={(event) => update('args', event.target.value)} placeholder={isEnglish ? 'Args JSON, e.g. ["-y", "docs-mcp"]' : 'Args JSON，例如 ["-y", "docs-mcp"]'} className="min-h-[72px] font-mono text-xs" />
          ) : (
            <Textarea value={form.headers} onChange={(event) => update('headers', event.target.value)} placeholder={isEnglish ? 'Headers JSON, e.g. {"Authorization":"Bearer ..."}' : 'Headers JSON，例如 {"Authorization":"Bearer ..."}'} className="min-h-[72px] font-mono text-xs" />
          )}
          <div className="grid gap-2 md:grid-cols-[1fr_160px]">
            <Textarea value={form.env} onChange={(event) => update('env', event.target.value)} placeholder={isEnglish ? 'Env JSON, e.g. {"API_KEY":"..."}' : 'Env JSON，例如 {"API_KEY":"..."}'} className="min-h-[72px] font-mono text-xs" />
            <Input value={form.toolTimeout} onChange={(event) => update('toolTimeout', event.target.value)} placeholder={isEnglish ? 'Timeout (ms)' : '超时 ms'} inputMode="numeric" className="h-9 rounded-lg" />
          </div>
          <div className="flex justify-end">
            <Button size="sm" disabled={!canSave || busy} onClick={onSave} className="h-8 rounded-lg text-xs">
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
              {isEnglish ? 'Save MCP' : '保存 MCP'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={'{"mcpServers":{"docs":{"command":"npx","args":["-y","docs-mcp"]}}}'}
            className="min-h-[160px] font-mono text-xs"
          />
          <div className="flex justify-end">
            <Button size="sm" disabled={!importText.trim() || busy} onClick={onImport} className="h-8 rounded-lg text-xs">
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Database className="mr-1.5 h-3.5 w-3.5" />}
              {isEnglish ? 'Import' : '导入'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function IconButton({
  children,
  title,
  busy,
  disabled,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled || busy}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        danger ? 'text-red-500 hover:bg-red-50' : 'text-[#656358] hover:bg-[#f3f2ee] hover:text-[#29261b]',
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}
