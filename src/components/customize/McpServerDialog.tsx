import { useEffect, useRef, useState } from "react";
import {
  Check,
  FileJson,
  Globe,
  Loader2,
  Play,
  Plus,
  Terminal,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { requestMcpEditor } from "@/core/api";
import type {
  McpImportPreview,
  McpPresetInfo,
  McpPresetsPayload,
} from "@/core/types";
import { createMcpForm, mcpFormValues, newPair, type McpPair } from "./mcpForm";
import SubTabBar from "./SubTabBar";

export function McpServerDialog({
  server,
  isEnglish,
  onClose,
  onResult,
}: {
  server?: McpPresetInfo;
  isEnglish: boolean;
  onClose: () => void;
  onResult: (payload: McpPresetsPayload) => void;
}) {
  const t = (zh: string, en: string) => (isEnglish ? en : zh);
  const [form, setForm] = useState(() => createMcpForm(server));
  const [savedServer, setSavedServer] = useState(server);
  const [mode, setMode] = useState<"remote" | "local" | "import">(
    form.transport === "stdio" ? "local" : "remote",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [probe, setProbe] = useState<McpPresetsPayload["probe"]>();
  const [importText, setImportText] = useState("");
  const [preview, setPreview] = useState<McpImportPreview[]>([]);
  const [decisions, setDecisions] = useState<
    Record<string, { action: string; name?: string }>
  >({});
  const revision = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const probeController = useRef<AbortController | null>(null);
  useEffect(() => () => probeController.current?.abort(), []);
  const canClose = !busy || busy === "probe";
  const close = () => {
    if (canClose) {
      probeController.current?.abort();
      onClose();
    }
  };
  const update = (patch: Partial<typeof form>) => {
    revision.current++;
    setProbe(undefined);
    setError("");
    setForm((current) => ({ ...current, ...patch }));
  };
  const switchMode = (next: typeof mode) => {
    setMode(next);
    update({ transport: next === "local" ? "stdio" : "streamableHttp" });
  };
  const submit = async (testOnly = false) => {
    setBusy(testOnly ? "probe" : "save");
    setError("");
    const current = revision.current;
    try {
      const values = mcpFormValues(form, savedServer);
      const controller = testOnly ? new AbortController() : undefined;
      probeController.current = controller ?? null;
      const result = await requestMcpEditor(
        testOnly ? "probe" : "save",
        values,
        controller?.signal,
      );
      if (testOnly) {
        if (current === revision.current) setProbe(result.probe);
      } else {
        onResult(result);
        const saved = result.presets.find(
          (item) => item.name === result.last_action?.names?.[0],
        );
        if (result.last_action?.saved && saved) {
          setSavedServer(saved);
          setForm((currentForm) => ({ ...currentForm, name: saved.name }));
        }
        if (result.last_action?.ok === false)
          setError(
            t(
              "配置已保存，连接尚未成功。可以修改后重试，或关闭窗口稍后查看状态。",
              "Configuration saved, but connection has not succeeded. Retry after editing or close to check status later.",
            ),
          );
        else onClose();
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError"))
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const importConfig = async (commit: boolean) => {
    setBusy(commit ? "import" : "preview");
    setError("");
    try {
      const result = await requestMcpEditor(
        commit ? "import" : "preview-import",
        { config: importText, decisions },
      );
      if (commit) {
        onResult(result);
        onClose();
      } else {
        const rows = result.import_preview ?? [];
        setPreview(rows);
        setDecisions(
          Object.fromEntries(
            rows.map((row) => [
              row.original_name,
              {
                action: row.errors.length ? "skip" : row.conflict ? "" : "add",
              },
            ]),
          ),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const setJson = (text: string) => {
    setImportText(text);
    setPreview([]);
    setError("");
  };
  const pickFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setError(
        t(
          "配置文件不能超过 1 MiB",
          "Configuration file must be smaller than 1 MiB",
        ),
      );
      return;
    }
    try {
      setJson(await file.text());
    } catch {
      setError(t("无法读取配置文件", "Could not read configuration file"));
    }
  };
  const canImport =
    preview.length > 0 &&
    preview.some(
      (row) =>
        decisions[row.original_name]?.action &&
        decisions[row.original_name]?.action !== "skip",
    ) &&
    preview.every((row) => {
      const choice = decisions[row.original_name];
      return (
        choice?.action === "skip" ||
        (!row.errors.length &&
          choice?.action &&
          (choice.action !== "rename" ||
            /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(choice.name ?? "")))
      );
    });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="mcp-dialog"
        showCloseButton={canClose}
        aria-describedby={undefined}
      >
        <DialogTitle className="mcp-dialog-title">
          {server
            ? t("编辑 MCP 服务", "Edit MCP server")
            : t("添加 MCP 服务", "Add MCP server")}
        </DialogTitle>
        {!savedServer && (
          <div className="mcp-modes">
            <SubTabBar
              tabs={[
                { id: "remote", icon: Globe, label: t("远程服务", "Remote server") },
                { id: "local", icon: Terminal, label: t("本地程序", "Local program") },
                { id: "import", icon: FileJson, label: t("导入配置", "Import config") },
              ]}
              activeTab={mode}
              ariaLabel={t("添加方式", "Connection method")}
              disabled={!!busy}
              onChange={(id) => switchMode(id as typeof mode)}
            />
          </div>
        )}
        <div className="mcp-dialog-body">
          {error && (
            <div className="mcp-feedback error" role="alert">
              {error}
            </div>
          )}
          {mode === "import" ? (
            <>
              <div className="mcp-import-heading">
                <label htmlFor="mcp-import-json">
                  {t("MCP 配置 JSON", "MCP configuration JSON")}
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={14} />
                  {t("选择文件", "Choose file")}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(event) => {
                    void pickFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </div>
              <Textarea
                id="mcp-import-json"
                className="mcp-json"
                value={importText}
                disabled={!!busy}
                onChange={(event) => setJson(event.target.value)}
                spellCheck={false}
                placeholder={
                  '{\n  "mcpServers": {\n    "docs": { "url": "https://example.com/mcp" }\n  }\n}'
                }
              />
              {preview.length > 0 && (
                <fieldset disabled={!!busy} className="mcp-import-preview">
                  {preview.map((row) => (
                    <div key={row.original_name} className="mcp-import-entry">
                      <div className="mcp-import-name">
                        <strong>{row.display_name}</strong>
                        <span>
                          {row.name} · {row.transport}
                        </span>
                      </div>
                      {row.errors.map((value) => (
                        <p className="mcp-error-text" key={value}>
                          {value}
                        </p>
                      ))}
                      {row.warnings.map((value) => (
                        <p className="mcp-warning-text" key={value}>
                          {value}
                        </p>
                      ))}
                      <Select
                        ariaLabel={`${row.display_name} ${t("导入处理", "import action")}`}
                        value={decisions[row.original_name]?.action ?? ""}
                        onChange={(action) =>
                          setDecisions((current) => ({
                            ...current,
                            [row.original_name]: { action },
                          }))
                        }
                        options={
                          row.errors.length
                            ? [{ value: "skip", label: t("跳过", "Skip") }]
                            : row.conflict
                              ? [
                                  {
                                    value: "",
                                    label: t(
                                      "存在同名服务，请选择",
                                      "Name conflict: choose an action",
                                    ),
                                  },
                                  {
                                    value: "replace",
                                    label: t(
                                      "替换已有配置",
                                      "Replace existing configuration",
                                    ),
                                  },
                                  {
                                    value: "rename",
                                    label: t(
                                      "使用新标识导入",
                                      "Import with another identifier",
                                    ),
                                  },
                                  { value: "skip", label: t("跳过", "Skip") },
                                ]
                              : [
                                  { value: "add", label: t("添加", "Add") },
                                  { value: "skip", label: t("跳过", "Skip") },
                                ]
                        }
                      />
                      {decisions[row.original_name]?.action === "rename" && (
                        <Input
                          aria-label={t("新服务标识", "New server identifier")}
                          value={decisions[row.original_name]?.name ?? ""}
                          placeholder="docs-2"
                          onChange={(event) =>
                            setDecisions((current) => ({
                              ...current,
                              [row.original_name]: {
                                action: "rename",
                                name: event.target.value,
                              },
                            }))
                          }
                        />
                      )}
                    </div>
                  ))}
                </fieldset>
              )}
            </>
          ) : (
            <fieldset disabled={!!busy} className="mcp-fields">
              <label>
                {t("服务名称", "Service name")}
                <Input
                  autoFocus
                  maxLength={120}
                  value={form.displayName}
                  onChange={(event) =>
                    update({ displayName: event.target.value })
                  }
                  placeholder={t(
                    "例如：公司知识库",
                    "e.g. Company knowledge base",
                  )}
                />
              </label>
              {mode === "remote" ? (
                <>
                  <label>
                    {t("服务地址", "Server URL")}
                    <Input
                      value={form.url}
                      onChange={(event) => update({ url: event.target.value })}
                      placeholder="https://example.com/mcp"
                    />
                  </label>
                  <label>
                    {t("认证方式", "Authentication")}
                    <Select
                      ariaLabel={t("认证方式", "Authentication")}
                      value={form.auth}
                      onChange={(value) =>
                        update({ auth: value as typeof form.auth })
                      }
                      options={[
                        { value: "none", label: t("无需认证", "None") },
                        { value: "bearer", label: "Bearer Token" },
                        {
                          value: "headers",
                          label: t(
                            "API Key / 自定义请求头",
                            "API key / Custom headers",
                          ),
                        },
                      ]}
                    />
                  </label>
                  {form.auth === "bearer" && (
                    <label>
                      {t("访问令牌", "Access token")}
                      <Input
                        type="password"
                        autoComplete="new-password"
                        value={form.token}
                        onChange={(event) =>
                          update({ token: event.target.value })
                        }
                      />
                    </label>
                  )}
                  {form.auth === "headers" && (
                    <PairEditor
                      label={t("请求头", "Headers")}
                      rows={form.headers}
                      onChange={(headers) => update({ headers })}
                      isEnglish={isEnglish}
                    />
                  )}
                </>
              ) : (
                <>
                  <label>
                    {t("启动程序", "Executable")}
                    <Input
                      value={form.command}
                      onChange={(event) =>
                        update({ command: event.target.value })
                      }
                      placeholder="npx / uvx / /path/to/program"
                    />
                  </label>
                  <div className="mcp-field-heading">
                    <span>{t("启动参数", "Arguments")}</span>
                    <button
                      type="button"
                      className="mcp-icon"
                      title={t("添加参数", "Add argument")}
                      onClick={() => update({ args: [...form.args, ""] })}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                  {form.args.map((arg, index) => (
                    <div key={index} className="mcp-argument">
                      <Input
                        aria-label={`${t("参数", "Argument")} ${index + 1}`}
                        value={arg}
                        onChange={(event) =>
                          update({
                            args: form.args.map((value, i) =>
                              i === index ? event.target.value : value,
                            ),
                          })
                        }
                      />
                      <button
                        type="button"
                        className="mcp-icon"
                        title={t("删除参数", "Remove argument")}
                        onClick={() =>
                          update({
                            args: form.args.filter((_, i) => i !== index),
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  <PairEditor
                    label={t("环境变量", "Environment variables")}
                    rows={form.env}
                    onChange={(env) => update({ env })}
                    isEnglish={isEnglish}
                  />
                </>
              )}
              <details className="mcp-advanced">
                <summary>{t("高级设置", "Advanced settings")}</summary>
                <div className="mcp-fields">
                  <label>
                    {t("服务标识", "Server identifier")}
                    <Input
                      value={form.name}
                      readOnly={!!savedServer}
                      onChange={(event) => update({ name: event.target.value })}
                      placeholder={t("自动生成", "Generated automatically")}
                    />
                  </label>
                  {mode === "remote" ? (
                    <label>
                      {t("传输协议", "Transport")}
                      <Select
                        ariaLabel={t("传输协议", "Transport")}
                        value={form.transport}
                        onChange={(value) =>
                          update({ transport: value as typeof form.transport })
                        }
                        options={[
                          { value: "streamableHttp", label: "Streamable HTTP" },
                          { value: "sse", label: "SSE (Legacy)" },
                        ]}
                      />
                    </label>
                  ) : (
                    <label>
                      {t("工作目录", "Working directory")}
                      <Input
                        value={form.cwd}
                        onChange={(event) =>
                          update({ cwd: event.target.value })
                        }
                        placeholder={t("可选", "Optional")}
                      />
                    </label>
                  )}
                  <div className="mcp-timeouts">
                    <label>
                      {t("连接超时（秒）", "Connection timeout (s)")}
                      <Input
                        type="number"
                        min={1}
                        max={300}
                        value={form.connectTimeout}
                        onChange={(event) =>
                          update({ connectTimeout: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      {t("工具超时（秒）", "Tool timeout (s)")}
                      <Input
                        type="number"
                        min={1}
                        max={600}
                        value={form.toolTimeout}
                        onChange={(event) =>
                          update({ toolTimeout: event.target.value })
                        }
                      />
                    </label>
                  </div>
                </div>
              </details>
            </fieldset>
          )}
          {probe && (
            <div
              className={`mcp-feedback ${probe.ok ? "success" : "error"}`}
              role="status"
            >
              <strong>
                {probe.ok
                  ? t(
                      `测试通过，发现 ${probe.tool_names?.length ?? 0} 个工具`,
                      `Test passed, ${probe.tool_names?.length ?? 0} tools found`,
                    )
                  : t("连接测试失败", "Connection test failed")}
              </strong>
              <p>{probe.message}</p>
            </div>
          )}
        </div>
        <div className="mcp-dialog-footer">
          <Button variant="outline" disabled={!canClose} onClick={close}>
            {t("取消", "Cancel")}
          </Button>
          <div className="mcp-footer-actions">
            {mode === "import" ? (
              <>
                <Button
                  variant="outline"
                  disabled={!!busy || !importText.trim()}
                  onClick={() => void importConfig(false)}
                >
                  {busy === "preview" ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    <FileJson size={14} />
                  )}
                  {t("解析预览", "Preview")}
                </Button>
                <Button
                  disabled={!!busy || !canImport}
                  onClick={() => void importConfig(true)}
                >
                  {busy === "import" ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    <Check size={14} />
                  )}
                  {t("确认导入", "Import selected")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => void submit(true)}
                >
                  {busy === "probe" ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    <Play size={14} />
                  )}
                  {t("测试连接", "Test connection")}
                </Button>
                <Button disabled={!!busy} onClick={() => void submit()}>
                  {busy === "save" ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    <Check size={14} />
                  )}
                  {server?.enabled === false
                    ? t("保存修改", "Save changes")
                    : t("保存并连接", "Save and connect")}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PairEditor({
  label,
  rows,
  onChange,
  isEnglish,
}: {
  label: string;
  rows: McpPair[];
  onChange: (rows: McpPair[]) => void;
  isEnglish: boolean;
}) {
  return (
    <div className="mcp-pairs">
      <div className="mcp-field-heading">
        <span>{label}</span>
        <button
          type="button"
          className="mcp-icon"
          title={isEnglish ? `Add ${label}` : `添加${label}`}
          onClick={() => onChange([...rows, newPair()])}
        >
          <Plus size={15} />
        </button>
      </div>
      {rows.map((row, index) => (
        <div className="mcp-pair" key={row.id}>
          <Input
            aria-label={`${label} ${isEnglish ? "key" : "名称"} ${index + 1}`}
            value={row.key}
            readOnly={row.stored}
            onChange={(event) =>
              onChange(
                rows.map((item) =>
                  item.id === row.id
                    ? { ...item, key: event.target.value }
                    : item,
                ),
              )
            }
            placeholder={isEnglish ? "Name" : "名称"}
          />
          <Input
            aria-label={`${label} ${isEnglish ? "value" : "值"} ${index + 1}`}
            type="password"
            autoComplete="new-password"
            value={row.value}
            onChange={(event) =>
              onChange(
                rows.map((item) =>
                  item.id === row.id
                    ? { ...item, value: event.target.value }
                    : item,
                ),
              )
            }
            placeholder={
              row.stored
                ? isEnglish
                  ? "Stored (unchanged)"
                  : "已保存（留空保持）"
                : isEnglish
                  ? "Value"
                  : "值"
            }
          />
          <button
            type="button"
            className="mcp-icon"
            title={isEnglish ? "Remove entry" : "删除条目"}
            onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
