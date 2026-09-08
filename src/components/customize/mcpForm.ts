import type { McpPresetInfo } from "@/core/types";

export interface McpPair {
  id: string;
  key: string;
  value: string;
  stored?: boolean;
}
export interface McpForm {
  displayName: string;
  name: string;
  transport: "stdio" | "streamableHttp" | "sse";
  command: string;
  args: string[];
  cwd: string;
  url: string;
  auth: "none" | "bearer" | "headers";
  token: string;
  env: McpPair[];
  headers: McpPair[];
  connectTimeout: string;
  toolTimeout: string;
}

export function newPair(key = "", stored = false): McpPair {
  return { id: crypto.randomUUID(), key, value: "", stored };
}

export function createMcpForm(server?: McpPresetInfo): McpForm {
  const connection = server?.connection;
  return {
    displayName: server?.display_name ?? "",
    name: server?.name ?? "",
    transport:
      connection?.transport === "stdio"
        ? "stdio"
        : connection?.transport === "sse"
          ? "sse"
          : "streamableHttp",
    command: connection?.command || "npx",
    args: connection?.args ?? [],
    cwd: connection?.cwd ?? "",
    url: connection?.url ?? "",
    auth: connection?.has_headers ? "headers" : "none",
    token: "",
    env: (connection?.env_keys ?? []).map((key) => newPair(key, true)),
    headers: (connection?.header_keys ?? []).map((key) => newPair(key, true)),
    connectTimeout: String(connection?.connect_timeout ?? 15),
    toolTimeout: String(connection?.tool_timeout ?? 30),
  };
}

function secretPatch(
  rows: McpPair[],
  previous: string[],
  ignoreCase = false,
): Record<string, string | null> {
  const patch: Record<string, string | null> = Object.fromEntries(
    previous.map((key) => [key, null]),
  );
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key && !row.value) continue;
    if (!key) throw new Error("变量名不能为空 / A key is required");
    const normalized = ignoreCase ? key.toLowerCase() : key;
    if (seen.has(normalized))
      throw new Error(`重复的变量名 / Duplicate key: ${key}`);
    seen.add(normalized);
    if (row.stored && !row.value && previous.includes(key)) delete patch[key];
    else patch[key] = row.value;
  }
  return patch;
}

export function mcpFormValues(
  form: McpForm,
  server?: McpPresetInfo,
): Record<string, unknown> {
  if (!form.displayName.trim())
    throw new Error("请输入服务名称 / Enter a service name");
  if (form.name && !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(form.name))
    throw new Error(
      "服务标识只能包含字母、数字、下划线或连字符 / Invalid server identifier",
    );
  if (form.transport === "stdio" && !form.command.trim())
    throw new Error("请输入启动程序 / Enter an executable");
  if (form.transport !== "stdio") {
    let url: URL;
    try {
      url = new URL(form.url);
    } catch {
      throw new Error("请输入有效的服务地址 / Enter a valid endpoint URL");
    }
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error(
        "服务地址必须使用 HTTP 或 HTTPS / HTTP or HTTPS is required",
      );
  }
  if (
    !/^\d+$/.test(form.connectTimeout) ||
    +form.connectTimeout < 1 ||
    +form.connectTimeout > 300
  )
    throw new Error(
      "连接超时范围为 1-300 秒 / Connection timeout: 1-300 seconds",
    );
  if (
    !/^\d+$/.test(form.toolTimeout) ||
    +form.toolTimeout < 1 ||
    +form.toolTimeout > 600
  )
    throw new Error("工具超时范围为 1-600 秒 / Tool timeout: 1-600 seconds");
  const headers = secretPatch(
    form.transport === "stdio" || form.auth !== "headers" ? [] : form.headers,
    server?.connection?.header_keys ?? [],
    true,
  );
  if (form.transport !== "stdio" && form.auth === "bearer") {
    if (!form.token.trim())
      throw new Error("请输入访问令牌 / Enter an access token");
    headers.Authorization = `Bearer ${form.token.trim().replace(/^Bearer\s+/i, "")}`;
  }
  return {
    name: form.name.trim() || undefined,
    original_name: server?.name,
    display_name: form.displayName.trim(),
    transport: form.transport,
    command: form.command.trim(),
    args: form.args,
    cwd: form.cwd.trim(),
    ...(server && form.url === server.connection?.url
      ? {}
      : { url: form.url.trim() }),
    env_patch: secretPatch(form.env, server?.connection?.env_keys ?? []),
    headers_patch: headers,
    connect_timeout: +form.connectTimeout,
    tool_timeout: +form.toolTimeout,
    enabled: server?.enabled !== false,
  };
}
