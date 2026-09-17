import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { requestMcpEditor } from "@/core/api";
import type {
  McpEditorAction,
  McpPresetInfo,
  McpPresetsPayload,
} from "@/core/types";
import { notifyMcpPresetsChanged } from "@/lib/mcp-preset-events";
import { useSettingsStore } from "@/stores/settingsStore";
import CenteredLoadingIndicator from "@/components/common/CenteredLoadingIndicator";
import { useI18n } from "@/i18n";
import { McpServerDialog } from "./McpServerDialog";
import SubTabBar from "./SubTabBar";
import "./mcpSettings.css";

interface MCPSectionProps {
  showAddForm?: boolean;
  onAddFormChange?: (open: boolean) => void;
}

export default function MCPSection({
  showAddForm,
  onAddFormChange,
}: MCPSectionProps = {}) {
  const { locale } = useI18n();
  const isEnglish = locale === "en-US";
  const t = (zh: string, en: string) => (isEnglish ? en : zh);
  const query = useSettingsStore((state) => state.toolboxSearchQuery)
    .trim()
    .toLowerCase();
  const [payload, setPayload] = useState<McpPresetsPayload>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"mine" | "recommended">("mine");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<McpPresetInfo>();
  const [installing, setInstalling] = useState<McpPresetInfo>();
  const [removing, setRemoving] = useState<McpPresetInfo>();
  const [details, setDetails] = useState<{
    name: string;
    tab: "logs" | "tools";
  }>();
  const [busy, setBusy] = useState<string | null>(null);
  const loadRevision = useRef(0);
  const apply = useCallback((next: McpPresetsPayload) => {
    setPayload(next);
    notifyMcpPresetsChanged(next);
  }, []);
  const refresh = useCallback(
    async (quiet = false) => {
      const request = ++loadRevision.current;
      if (!quiet) setLoading(true);
      try {
        const next = await requestMcpEditor("list");
        if (request === loadRevision.current) {
          apply(next);
          if (!quiet) setError("");
        }
      } catch (err) {
        if (request === loadRevision.current && !quiet)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (request === loadRevision.current) setLoading(false);
      }
    },
    [apply],
  );
  useEffect(() => {
    const revision = loadRevision;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh(true);
    }, 4000);
    return () => {
      clearInterval(timer);
      revision.current++;
    };
  }, [refresh]);
  const closeEditor = () => {
    setAdding(false);
    setEditing(undefined);
    onAddFormChange?.(false);
  };
  const onResult = (next: McpPresetsPayload) => {
    loadRevision.current++;
    apply(next);
    setLoading(false);
    setTab("mine");
    if (next.requires_restart)
      setNotice(
        t(
          "配置已保存，网关尚未完成应用。请刷新状态，必要时重启应用。",
          "Configuration saved; the gateway has not applied it yet. Refresh status or restart the app.",
        ),
      );
    else if (next.last_action?.ok === false)
      setNotice(
        t(
          "配置已保存，部分服务尚未连接。请查看对应服务的连接记录。",
          "Configuration saved; some servers are not connected. Check their connection records.",
        ),
      );
    else setNotice("");
  };
  const action = async (
    kind: McpEditorAction,
    server: McpPresetInfo,
    values: Record<string, unknown> = {},
  ) => {
    if (busy) return;
    setBusy(server.name);
    setError("");
    try {
      onResult(await requestMcpEditor(kind, { name: server.name, ...values }));
      if (kind === "remove") {
        setRemoving(undefined);
        setDetails(undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const services = useMemo(() => payload?.presets ?? [], [payload]);
  const visible = useMemo(
    () =>
      services
        .filter((server) =>
          tab === "mine" ? server.installed : server.source === "preset",
        )
        .filter(
          (server) =>
            !query ||
            `${server.display_name} ${server.name} ${server.description} ${server.connection_summary}`
              .toLowerCase()
              .includes(query),
        ),
    [services, tab, query],
  );
  const selected =
    details && services.find((server) => server.name === details.name);
  const count = services.filter((server) => server.installed).length;

  return (
    <div data-mcp-surface className="mcp-settings">
      <header data-page-section-heading>
        <h2>{t("连接器", "Connectors")}</h2>
        <p>{t("连接研究所需的数据源和外部工具，统一管理服务状态。", "Connect your data sources and tools, and manage their availability.")}</p>
      </header>
      <div className="mcp-toolbar">
        <SubTabBar
          tabs={[
            { id: "mine", label: t("我的服务", "My servers"), count },
            { id: "recommended", label: t("推荐服务", "Recommended") },
          ]}
          activeTab={tab}
          onChange={(id) => setTab(id as typeof tab)}
          ariaLabel={t("MCP 服务", "MCP servers")}
        />
        <div className="mcp-row-actions">
          <button
            type="button"
            className="mcp-icon"
            title={t("刷新状态", "Refresh status")}
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          {!onAddFormChange && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus size={15} />
              {t("添加 MCP", "Add MCP")}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className="mcp-feedback error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mcp-feedback warning">
          {notice}
        </div>
      )}
      <div className="mcp-server-list">
        {loading && !payload ? (
          <CenteredLoadingIndicator
            label={t("正在加载服务", "Loading servers")}
            className="min-h-[240px]"
          />
        ) : !visible.length ? (
          <div className="mcp-empty">
            <p>
              {query
                ? t("没有匹配的服务", "No matching servers")
                : t("尚未添加 MCP 服务", "No MCP servers added")}
            </p>
            {!query && (
              <Button
                variant="outline"
                onClick={() => {
                  setAdding(true);
                  onAddFormChange?.(true);
                }}
              >
                <Plus size={15} />
                {t("添加 MCP", "Add MCP")}
              </Button>
            )}
          </div>
        ) : (
          visible.map((server) => {
            const state = !server.installed
              ? "not_installed"
              : server.enabled === false
                ? "disabled"
                : (server.connection_state ?? "pending");
            const statusText: Record<string, string> = {
              not_installed: t("未添加", "Not added"),
              pending: t("等待连接", "Pending"),
              connecting: t("连接中", "Connecting"),
              connected: t("已连接", "Connected"),
              failed: t("连接失败", "Connection failed"),
              needs_auth: t("需要认证", "Authentication required"),
              disabled: t("已停用", "Disabled"),
            };
            return (
              <article
                key={server.name}
                data-mcp-card
                data-enabled={server.enabled === false ? "false" : "true"}
                className="mcp-server-row rounded-lg border border-neutral-200/70 bg-white p-3 transition-colors hover:border-neutral-300"
              >
                <div className="mcp-server-heading">
                  <div data-mcp-icon className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
                    <Server className="h-4 w-4" />
                  </div>
                  <div className="mcp-server-info">
                    <h3 data-mcp-name className="truncate text-sm font-medium text-neutral-900" title={server.display_name}>{server.display_name}</h3>
                    <p data-mcp-description className="mt-1 truncate text-xs text-neutral-500" title={server.connection_summary || server.description}>{server.connection_summary || server.description}</p>
                  </div>
                  {server.installed ? (
                    <Toggle
                      aria-label={`${server.display_name} ${t("启用", "enabled")}`}
                      checked={server.enabled !== false}
                      disabled={!!busy}
                      size="md"
                      onChange={() =>
                        void action("toggle", server, {
                          enabled: server.enabled === false,
                        })
                      }
                    />
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!busy || !server.install_supported}
                      onClick={() => setInstalling(server)}
                    >
                      <Plus size={14} />
                      {t("添加", "Add")}
                    </Button>
                  )}
                </div>
                <div data-mcp-card-footer className="mcp-server-bottom">
                  <div className="mcp-server-meta">
                    <span className={`mcp-status ${state}`}>
                      <span aria-hidden="true" className={`mcp-state-dot ${state}`} />
                      {statusText[state]}
                    </span>
                    <span>
                      {server.transport === "stdio"
                        ? t("本地程序", "Local program")
                        : server.transport === "sse"
                          ? "SSE"
                          : "HTTP"}
                    </span>
                    {state === "connected" && (
                      <span>
                        {server.tool_count ?? 0} {t("个工具", "tools")}
                      </span>
                    )}
                  </div>
                  {server.installed && (
                    <div className="mcp-row-actions">
                      <button
                        type="button"
                        className="mcp-icon"
                        title={t("编辑配置", "Edit configuration")}
                        disabled={!!busy}
                        onClick={() =>
                          server.required_fields.some(
                            (field) => field.required && !field.configured,
                          )
                            ? setInstalling(server)
                            : setEditing(server)
                        }
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="mcp-icon"
                        title={t("重新连接", "Reconnect")}
                        disabled={!!busy || server.enabled === false}
                        onClick={() => void action("reconnect", server)}
                      >
                        {busy === server.name ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <RefreshCw size={15} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="mcp-icon"
                        title={t("工具范围", "Tool access")}
                        onClick={() =>
                          setDetails({ name: server.name, tab: "tools" })
                        }
                      >
                        <SlidersHorizontal size={15} />
                      </button>
                      <button
                        type="button"
                        className="mcp-icon"
                        title={t("连接记录", "Connection records")}
                        onClick={() =>
                          setDetails({ name: server.name, tab: "logs" })
                        }
                      >
                        <FileText size={15} />
                      </button>
                      <button
                        type="button"
                        className="mcp-icon danger"
                        title={t("删除服务", "Delete server")}
                        disabled={!!busy}
                        onClick={() => setRemoving(server)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>
                {server.enabled !== false && server.error && (
                  <p className="mcp-server-error">{server.error}</p>
                )}
              </article>
            );
          })
        )}
      </div>
      {(adding || showAddForm || editing) && (
        <McpServerDialog
          key={editing?.name ?? "new"}
          server={editing}
          isEnglish={isEnglish}
          onClose={closeEditor}
          onResult={onResult}
        />
      )}
      {installing && (
        <PresetInstallDialog
          server={installing}
          isEnglish={isEnglish}
          onClose={() => setInstalling(undefined)}
          onResult={onResult}
        />
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setRemoving(undefined);
          }}
        >
          <DialogContent
            className="mcp-small-dialog"
            aria-describedby={undefined}
          >
            <DialogTitle>{t("删除 MCP 服务", "Delete MCP server")}</DialogTitle>
            <p className="mcp-confirm-text">
              {t(
                `删除“${removing.display_name}”的连接配置？`,
                `Delete the connection configuration for ${removing.display_name}?`,
              )}
            </p>
            <div className="mcp-dialog-footer">
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => setRemoving(undefined)}
              >
                {t("取消", "Cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={!!busy}
                onClick={() => void action("remove", removing)}
              >
                <Trash2 size={14} />
                {t("删除", "Delete")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {selected && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDetails(undefined);
          }}
        >
          <DialogContent className="mcp-dialog" aria-describedby={undefined}>
            <DialogTitle className="mcp-dialog-title">
              {selected.display_name}
            </DialogTitle>
            <div className="mcp-modes">
              <SubTabBar
                tabs={[
                  { id: "tools", label: t("工具范围", "Tool access") },
                  { id: "logs", label: t("连接记录", "Connection records") },
                ]}
                activeTab={details.tab}
                ariaLabel={selected.display_name}
                onChange={(tab) => setDetails({ name: selected.name, tab: tab as "tools" | "logs" })}
              />
            </div>
            <div className="mcp-dialog-body">
              {details.tab === "logs" ? (
                <div className="mcp-log-list">
                  {selected.error && (
                    <div className="mcp-feedback error">{selected.error}</div>
                  )}
                  {selected.diagnostics?.length ? (
                    selected.diagnostics.map((entry, index) => (
                      <div key={index}>
                        <time>
                          {new Date(entry.time).toLocaleString(locale)}
                        </time>
                        <p>{entry.message}</p>
                      </div>
                    ))
                  ) : (
                    <p>{t("暂无连接记录", "No connection records yet")}</p>
                  )}
                </div>
              ) : (
                <ToolScope
                  key={selected.name}
                  server={selected}
                  busy={!!busy}
                  isEnglish={isEnglish}
                  onSave={(enabled_tools) =>
                    void action("tools", selected, { enabled_tools })
                  }
                />
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function PresetInstallDialog({
  server,
  isEnglish,
  onClose,
  onResult,
}: {
  server: McpPresetInfo;
  isEnglish: boolean;
  onClose: () => void;
  onResult: (payload: McpPresetsPayload) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await requestMcpEditor("enable", { name: server.name, ...values });
      onResult(result);
      if (result.last_action?.ok === false) {
        setError(isEnglish
          ? 'Configuration saved, but connection has not succeeded. Edit and retry, or close to check status later.'
          : '配置已保存，连接尚未成功。可以修改后重试，或关闭窗口稍后查看状态。');
      } else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="mcp-small-dialog"
        aria-describedby={undefined}
        showCloseButton={!busy}
      >
        <DialogTitle>{server.display_name}</DialogTitle>
        {error && (
          <div className="mcp-feedback error" role="alert">
            {error}
          </div>
        )}
        <div className="mcp-fields">
          {server.required_fields.map((field) => (
            <label key={field.name}>
              {field.label}
              <Input
                type={field.secret ? "password" : "text"}
                autoComplete="new-password"
                disabled={busy}
                value={values[field.name] ?? ""}
                placeholder={
                  field.configured
                    ? isEnglish
                      ? "Stored (unchanged)"
                      : "已保存（留空保持）"
                    : field.placeholder
                }
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.name]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
        </div>
        <div className="mcp-dialog-footer">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {isEnglish ? "Cancel" : "取消"}
          </Button>
          <Button
            disabled={
              busy ||
              server.required_fields.some(
                (field) =>
                  field.required &&
                  !field.configured &&
                  !values[field.name]?.trim(),
              )
            }
            onClick={() => void save()}
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            {isEnglish ? "Save and connect" : "保存并连接"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToolScope({
  server,
  busy,
  isEnglish,
  onSave,
}: {
  server: McpPresetInfo;
  busy: boolean;
  isEnglish: boolean;
  onSave: (tools: string[]) => void;
}) {
  const tools = server.tool_names ?? [];
  const [selection, setSelection] = useState(() =>
    (server.enabled_tools ?? ["*"]).map((name) =>
      name === "*" || tools.includes(name)
        ? name
        : `mcp_${server.name}_${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_"),
    ),
  );
  if (!tools.length)
    return (
      <p>
        {isEnglish
          ? "No tools discovered. Reconnect the server to refresh."
          : "暂无已发现的工具，请重新连接服务后查看。"}
      </p>
    );
  return (
    <>
      <label className="mcp-tool-option">
        <input
          type="checkbox"
          checked={selection.includes("*")}
          disabled={busy}
          onChange={(event) => setSelection(event.target.checked ? ["*"] : [])}
        />
        {isEnglish
          ? "Enable all tools, including newly discovered tools"
          : "启用全部工具（含后续新增工具）"}
      </label>
      <div className="mcp-tool-list">
        {tools.map((name) => (
          <label key={name} className="mcp-tool-option">
            <input
              type="checkbox"
              disabled={busy}
              checked={selection.includes("*") || selection.includes(name)}
              onChange={(event) => {
                const chosen = new Set(
                  selection.includes("*") ? tools : selection,
                );
                if (event.target.checked) chosen.add(name);
                else chosen.delete(name);
                setSelection([...chosen]);
              }}
            />
            <span>{name}</span>
          </label>
        ))}
      </div>
      <div className="mcp-tool-save">
        <Button disabled={busy} onClick={() => onSave(selection)}>
          <Check size={14} />
          {isEnglish ? "Save tool access" : "保存工具范围"}
        </Button>
      </div>
    </>
  );
}
