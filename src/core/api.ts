import type {
  ArchivedDataPayload,
  ChatSummary,
  CliAppsPayload,
  ExpertTeamDetail,
  ExpertTeamsPayload,
  ImageGenerationSettingsUpdate,
  TranscriptionSettingsUpdate,
  McpPresetsPayload,
  ModelConfigurationCreate,
  ModelDefaultUpdate,
  ModelConfigurationUpdate,
  NetworkSafetySettingsUpdate,
  ProviderSettingsCreate,
  ProviderModelsPayload,
  ProviderSettingsUpdate,
  ProjectPayload,
  ProjectSessionPayload,
  ScheduleTasksPayload,
  SettingsPayload,
  SettingsUpdate,
  SidebarStatePayload,
  SlashCommand,
  SkillsPayload,
  WebSearchSettingsUpdate,
  WorkspacesPayload,
  WebuiThreadPersistedPayload,
  ThreadResource,
  ThreadRuntimeSnapshot,
  TraceContextItemResource,
  TraceResource,
  TraceSpanResource,
  TurnPlanResource,
  WorkspaceScopePayload,
  PersonalizationPayload,
  SecurityAuditPage,
  SecurityPolicyPayload,
  SecurityPolicyUpdate,
} from "./types";
import type { ScheduleConfig } from "@/types/schedule";
import { isProtectedBuiltinModelProvider } from "@/config/builtinModelServices";
import { fetchWithTimeout } from "./bootstrap";
import { recordDiagnostic, startDiagnostic } from './diagnostics';
import { diagnosticError, diagnosticId, diagnosticRoute } from '../shared/diagnostics';
import { classifyDiagnosticError, diagnosticSymbol } from '../shared/diagnosticErrors';

const API_READ_TIMEOUT_MS = 20_000;

/**
 * Keep every canonical thread read on the gateway's maximum bounded page.
 * Expert-team runs can legitimately produce hundreds of durable progress
 * events, so the old implicit 200-row default could hide earlier user turns.
 */
export const THREAD_HISTORY_MESSAGE_LIMIT = 500;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

let tokenProvider: (() => Promise<string>) | null = null;

export function registerTokenProvider(provider: (() => Promise<string>) | null) {
  tokenProvider = provider;
}

/**
 * Execute one authenticated gateway request and refresh the short-lived token
 * exactly once after a 401. Binary artifact reads use this same transport so
 * list, preview and download cannot drift into different auth behaviour.
 */
export async function fetchGatewayResponse(
  url: string,
  token: string,
  init?: RequestInit,
  timeoutMs: number = 0,
): Promise<Response> {
  const actionId = diagnosticId('action');
  let attempt = 0;
  const execute = async (currentToken: string) => {
    const request_id = diagnosticId('http');
    const operation = startDiagnostic('http.request', { request_id, client_action_id: actionId,
      details: { route: diagnosticRoute(url), method: init?.method ?? 'GET', attempt: ++attempt, timeout_ms: timeoutMs } });
    try {
      const response = await fetchWithTimeout(url, {
        ...(init ?? {}),
        headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${currentToken}`,
          'X-Request-Id': request_id, 'X-Client-Action-Id': actionId },
        credentials: 'same-origin',
      }, timeoutMs);
      operation.finish(response.ok ? 'completed' : 'failed', { status_code: response.status,
        error_category: response.ok ? undefined : classifyDiagnosticError(undefined, response.status),
        server_request_id: diagnosticSymbol(response.headers?.get?.('x-request-id')),
        auth_mode: 'gateway_bearer', auth_header_present: Boolean(currentToken) });
      return response;
    } catch (cause) {
      operation.finish(init?.signal?.aborted ? 'cancelled' : 'failed', diagnosticError(cause));
      throw cause;
    }
  };

  const res = await execute(token);
  if (res.status !== 401 || !tokenProvider) return res;

  let refreshedToken: string;
  try {
    recordDiagnostic({ event_name: 'http.auth_refresh', client_action_id: actionId, status: 'started' });
    refreshedToken = await tokenProvider();
    recordDiagnostic({ event_name: 'http.auth_refresh', client_action_id: actionId, status: 'completed' });
  } catch (refreshErr) {
    recordDiagnostic({ event_name: 'http.auth_refresh', client_action_id: actionId, status: 'failed', level: 'error', details: diagnosticError(refreshErr) });
    console.error("Token refresh failed during 401 retry:", refreshErr);
    return res;
  }
  try { return await execute(refreshedToken); }
  catch { return res; }
}

async function request<T>(
  url: string,
  token: string,
  init?: RequestInit,
  timeoutMs: number = 0,
): Promise<T> {
  const res = await fetchGatewayResponse(url, token, init, timeoutMs);

  if (!res.ok) {
    const text = typeof res.text === "function" ? (await res.text()).trim() : "";
    throw new ApiError(res.status, text || `HTTP ${res.status}`);
  }
  const contentType = res.headers?.get?.("content-type") ?? "";
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    recordDiagnostic({ event_name: 'http.invalid_response', request_id: res.headers?.get?.('X-Request-Id') ?? undefined,
      status: 'failed', level: 'error', details: { route: diagnosticRoute(url), status_code: res.status, error_code: 'NON_JSON_RESPONSE' } });
    const text = typeof res.text === "function" ? await res.text() : "";
    const isHtml = text.trimStart().toLowerCase().startsWith("<!doctype");
    throw new ApiError(
      res.status,
      isHtml
         ? "Gateway returned WebUI HTML instead of JSON. Restart the app and try again."
        : "Gateway returned a non-JSON response.",
    );
  }
  try {
    return (await res.json()) as T;
  } catch (cause) {
    recordDiagnostic({ event_name: 'http.invalid_response', request_id: res.headers?.get?.('X-Request-Id') ?? undefined,
      status: 'failed', level: 'error', details: { route: diagnosticRoute(url), status_code: res.status,
        ...diagnosticError(cause), error_code: 'JSON_READ_FAILED' } });
    throw cause;
  }
}

function mcpValuesHeader(values: Record<string, unknown>): HeadersInit | undefined {
  const payload: Record<string, unknown> = {};
  Object.entries(values).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) payload[key] = trimmed;
      return;
    }
    payload[key] = value;
  });
  if (!Object.keys(payload).length) return undefined;
  // Header values must stay ISO-8859-1; escape non-ASCII characters (e.g.
  // Chinese server names, tokens, or custom header JSON) as \uXXXX.
  return { "X-Nanobot-MCP-Values": asciiJsonStringify(payload) };
}

function skillValuesHeader(values: Record<string, unknown>): HeadersInit | undefined {
  const payload: Record<string, unknown> = {};
  Object.entries(values).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    payload[key] = value;
  });
  if (!Object.keys(payload).length) return undefined;
  return { "X-Nanobot-Skill-Values": asciiJsonStringify(payload) };
}

function personalizationValuesHeader(values: Record<string, unknown>): HeadersInit | undefined {
  const payload: Record<string, unknown> = {};
  Object.entries(values).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    payload[key] = value;
  });
  if (!Object.keys(payload).length) return undefined;
  // Header values must stay ISO-8859-1; escape non-ASCII (e.g. Chinese text)
  // as \uXXXX, exactly like the MCP/Skill values headers.
  return { "X-Nanobot-Personalization-Values": asciiJsonStringify(payload) };
}

function projectSkillValuesHeader(values: Record<string, unknown>): HeadersInit | undefined {
  const payload: Record<string, unknown> = {};
  Object.entries(values).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    payload[key] = value;
  });
  if (!Object.keys(payload).length) return undefined;
  return { "X-Nanobot-Project-Skill-Values": asciiJsonStringify(payload) };
}

function asciiJsonStringify(value: unknown): string {
  return JSON.stringify(value).replace(/[^\x00-\x7F]/g, (char) => (
    `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  ));
}

function splitKey(key: string): { channel: string; chatId: string } {
  const idx = key.indexOf(":");
  if (idx === -1) return { channel: "", chatId: key };
  const channel = key.slice(0, idx);
  return { channel, chatId: channel === "cron" ? key : key.slice(idx + 1) };
}

export async function listSessions(
  token: string,
  base: string = "",
): Promise<ChatSummary[]> {
  type Row = {
    key: string;
    session_id?: string;
    project_id?: string;
    created_at: string | null;
    updated_at: string | null;
    title?: string;
    preview?: string;
    run_started_at?: number | null;
    workspace_scope?: WorkspaceScopePayload | null;
    expert_team?: import("./types").ExpertTeamBinding | null;
    mcp_presets?: import("./types").UIMcpPresetAttachment[];
  };
  const body = await request<{ sessions: Row[] }>(
    `${base}/api/sessions`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
  return body.sessions.map((s) => ({
    key: s.key,
    ...splitKey(s.key),
    sessionId: s.session_id,
    projectId: s.project_id,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    title: s.title ?? "",
    preview: s.preview ?? "",
    runStartedAt: s.run_started_at ?? null,
    workspaceScope: s.workspace_scope ?? null,
    expertTeam: s.expert_team ?? null,
    mcpPresets: s.mcp_presets ?? [],
  }));
}

export async function listProjects(
  token: string,
  base: string = "",
): Promise<ProjectPayload[]> {
  type Row = {
    id: string;
    kind: ProjectPayload["kind"];
    name: string;
    root_path: string;
    status: ProjectPayload["status"];
    created_at: number;
    updated_at: number;
  };
  const body = await request<{ projects: Row[] }>(
    `${base}/api/projects`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
  return body.projects.map((project) => ({
    id: project.id,
    kind: project.kind,
    name: project.name,
    rootPath: project.root_path,
    status: project.status,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  }));
}

export async function listProjectSessions(
  token: string,
  projectId: string,
  base: string = "",
): Promise<ProjectSessionPayload[]> {
  type Row = {
    id: string;
    project_id: string;
    session_key: string;
    title: string;
    status: string;
    created_at: number;
    updated_at: number;
  };
  const body = await request<{ sessions: Row[] }>(
    `${base}/api/projects/${encodeURIComponent(projectId)}/sessions`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
  return body.sessions.map((session) => ({
    id: session.id,
    projectId: session.project_id,
    sessionKey: session.session_key,
    title: session.title,
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  }));
}

function mapProject(project: {
  id: string;
  kind: ProjectPayload["kind"];
  name: string;
  root_path: string;
  status: ProjectPayload["status"];
  created_at: number;
  updated_at: number;
}): ProjectPayload {
  return {
    id: project.id,
    kind: project.kind,
    name: project.name,
    rootPath: project.root_path,
    status: project.status,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

export async function archiveProject(
  token: string,
  projectId: string,
  base: string = "",
): Promise<ProjectPayload> {
  const body = await request<{ project: Parameters<typeof mapProject>[0] }>(
    `${base}/api/projects/${encodeURIComponent(projectId)}/archive`,
    token,
  );
  return mapProject(body.project);
}

export async function restoreProject(
  token: string,
  projectId: string,
  base: string = "",
): Promise<ProjectPayload> {
  const body = await request<{ project: Parameters<typeof mapProject>[0] }>(
    `${base}/api/projects/${encodeURIComponent(projectId)}/restore`,
    token,
  );
  return mapProject(body.project);
}

export async function relocateProject(
  token: string,
  projectId: string,
  path: string,
  base: string = "",
): Promise<ProjectPayload> {
  const query = new URLSearchParams({ path });
  const body = await request<{ project: Parameters<typeof mapProject>[0] }>(
    `${base}/api/projects/${encodeURIComponent(projectId)}/relocate?${query}`,
    token,
  );
  return mapProject(body.project);
}

export async function exportProjectArchive(
  token: string,
  projectId: string,
  base: string = "",
): Promise<Uint8Array> {
  const response = await fetchGatewayResponse(
    `${base}/api/projects/${encodeURIComponent(projectId)}/export`,
    token,
    { method: "GET" },
    API_READ_TIMEOUT_MS,
  );
  if (!response.ok) {
    const detail = typeof response.text === "function" ? await response.text() : "";
    throw new ApiError(response.status, detail || `HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Disk-backed WebUI display thread snapshot. */
export async function fetchWebuiThread(
  token: string,
  key: string,
  base: string = "",
  options: {
    limit?: number;
    direction?: "latest";
    before?: string;
  } = {},
): Promise<WebuiThreadPersistedPayload | null> {
  const query = new URLSearchParams();
  query.set(
    "limit",
    String(Math.max(1, options.limit ?? THREAD_HISTORY_MESSAGE_LIMIT)),
  );
  if (options.direction) query.set("direction", options.direction);
  if (options.before) query.set("before", options.before);
  const queryString = query.toString();
  const suffix = queryString ? `?${queryString}` : "";
  const url = `${base}/api/sessions/${encodeURIComponent(key)}/webui-thread${suffix}`;
  const res = await fetchGatewayResponse(url, token);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return (await res.json()) as WebuiThreadPersistedPayload;
}

/** Fetch the canonical, session-partitioned conversation read model. */
export async function fetchThreadResource(
  token: string,
  key: string,
  base: string = "",
  options: {
    afterEventSeq?: number;
    beforeMessageEventSeq?: number;
    messageLimit?: number;
  } = {},
): Promise<ThreadResource | null> {
  const query = new URLSearchParams();
  if (options.afterEventSeq != null) {
    query.set("after_event_seq", String(Math.max(0, options.afterEventSeq)));
  }
  query.set(
    "message_limit",
    String(Math.max(1, options.messageLimit ?? THREAD_HISTORY_MESSAGE_LIMIT)),
  );
  if (options.beforeMessageEventSeq != null) {
    query.set(
      "before_message_event_seq",
      String(Math.max(1, options.beforeMessageEventSeq)),
    );
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  const url = `${base}/api/sessions/${encodeURIComponent(key)}/thread${suffix}`;
  const res = await fetchGatewayResponse(url, token, undefined, API_READ_TIMEOUT_MS);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return (await res.json()) as ThreadResource;
}

/** Authoritative process-local runtime state plus the latest durable terminal turn. */
export async function fetchSessionRuntimeSnapshot(
  token: string,
  key: string,
  base: string = "",
): Promise<ThreadRuntimeSnapshot | null> {
  const url = `${base}/api/sessions/${encodeURIComponent(key)}/runtime-snapshot`;
  const res = await fetchGatewayResponse(url, token, undefined, API_READ_TIMEOUT_MS);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return (await res.json()) as ThreadRuntimeSnapshot;
}

export async function fetchTraces(
  token: string,
  base: string = "",
  filters: {
    projectId?: string;
    sessionId?: string;
    turnId?: string;
    status?: string;
    limit?: number;
  } = {},
): Promise<TraceResource[]> {
  const query = new URLSearchParams();
  if (filters.projectId) query.set("project_id", filters.projectId);
  if (filters.sessionId) query.set("session_id", filters.sessionId);
  if (filters.turnId) query.set("turn_id", filters.turnId);
  if (filters.status) query.set("status", filters.status);
  if (filters.limit != null) query.set("limit", String(filters.limit));
  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await request<{ traces?: TraceResource[] }>(
    `${base}/api/traces${suffix}`,
    token,
  );
  return response.traces ?? [];
}

export async function fetchTrace(
  token: string,
  traceId: string,
  base: string = "",
): Promise<TraceResource | null> {
  const res = await fetchGatewayResponse(
    `${base}/api/traces/${encodeURIComponent(traceId)}`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  const body = (await res.json()) as { trace?: TraceResource };
  return body.trace ?? null;
}

export async function fetchTraceSpans(
  token: string,
  traceId: string,
  base: string = "",
): Promise<TraceSpanResource[]> {
  const response = await request<{ spans?: TraceSpanResource[] }>(
    `${base}/api/traces/${encodeURIComponent(traceId)}/spans`,
    token,
  );
  return response.spans ?? [];
}

export async function fetchTraceContext(
  token: string,
  traceId: string,
  base: string = "",
): Promise<TraceContextItemResource[]> {
  const response = await request<{ context_manifest?: TraceContextItemResource[] }>(
    `${base}/api/traces/${encodeURIComponent(traceId)}/context`,
    token,
  );
  return response.context_manifest ?? [];
}

export async function fetchTurnPlan(
  token: string,
  key: string,
  turnId: string,
  base: string = "",
): Promise<TurnPlanResource | null> {
  const url = (
    `${base}/api/sessions/${encodeURIComponent(key)}`
    + `/turns/${encodeURIComponent(turnId)}/plan`
  );
  const res = await fetchGatewayResponse(url, token, undefined, API_READ_TIMEOUT_MS);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  const body = (await res.json()) as { plan?: TurnPlanResource };
  return body.plan ?? null;
}

/** @deprecated Use archiveSession; the gateway does not delete on this action. */
export async function deleteSession(
  token: string,
  key: string,
  base: string = "",
): Promise<boolean> {
  return archiveSession(token, key, base);
}

export async function archiveSession(
  token: string,
  key: string,
  base: string = "",
): Promise<boolean> {
  const body = await request<{
    archived?: boolean;
    blocked_by_automations?: boolean;
    automations?: Array<{ name?: string }>;
  }>(
    `${base}/api/sessions/${encodeURIComponent(key)}/archive`,
    token,
  );
  if (body.archived === true) return true;
  if (body.blocked_by_automations) {
    const names = Array.from(new Set(
      (body.automations ?? [])
        .map((automation) => automation.name?.trim())
        .filter((name): name is string => Boolean(name)),
    ));
    const detail = names.length > 0 ? `：${names.join("、")}` : "";
    throw new Error(
      `该会话仍关联自动化任务${detail}。请先在“自动化”中删除任务，再归档会话。`,
    );
  }
  throw new Error("本地服务未确认会话归档，请刷新后重试");
}

export async function restoreSession(
  token: string,
  key: string,
  base: string = "",
): Promise<boolean> {
  const body = await request<{ restored: boolean }>(
    `${base}/api/sessions/${encodeURIComponent(key)}/restore`,
    token,
  );
  return body.restored;
}

export async function purgeSession(
  token: string,
  key: string,
  base: string = "",
): Promise<boolean> {
  const response = await fetchGatewayResponse(
    `${base}/api/sessions/${encodeURIComponent(key)}/purge`,
    token,
  );
  const body = await response.json() as {
    purged?: boolean;
    blocked_by_automations?: boolean;
    automations?: Array<{ name?: string }>;
    error?: string;
  };
  if (body.purged === true) return true;
  if (body.blocked_by_automations) {
    const names = Array.from(new Set(
      (body.automations ?? [])
        .map((automation) => automation.name?.trim())
        .filter((name): name is string => Boolean(name)),
    ));
    const detail = names.length > 0 ? `：${names.join("、")}` : "";
    throw new ApiError(
      response.status,
      `该会话仍关联正在使用的自动化任务${detail}。请先在“自动化”中删除任务。`,
    );
  }
  throw new ApiError(
    response.status,
    body.error || "本地服务未确认永久删除，请刷新后重试",
  );
}

export async function purgeProject(
  token: string,
  projectId: string,
  base: string = "",
): Promise<boolean> {
  const body = await request<{ purged: boolean }>(
    `${base}/api/projects/${encodeURIComponent(projectId)}/purge`,
    token,
  );
  return body.purged;
}

export async function fetchArchivedData(
  token: string,
  base: string = "",
): Promise<ArchivedDataPayload> {
  type Body = {
    schema_version: number;
    archived_sessions: Array<{
      session_key: string;
      session_id?: string;
      project_id: string;
      title: string;
      preview: string;
      project_name: string;
      project_root: string;
      created_at: string | null;
      updated_at: string | null;
      archived_at: number;
    }>;
    archived_projects: Array<{
      id: string;
      kind: import("./types").ProjectPayload["kind"];
      name: string;
      root_path: string;
      status: import("./types").ProjectPayload["status"];
      created_at: number;
      updated_at: number;
      archived_at: number;
      session_count: number;
      files_deleted: false;
    }>;
  };
  const body = await request<Body>(
    `${base}/api/data-management/archives`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
  return {
    schemaVersion: body.schema_version,
    archivedSessions: body.archived_sessions.map((session) => ({
      sessionKey: session.session_key,
      sessionId: session.session_id,
      projectId: session.project_id,
      title: session.title,
      preview: session.preview,
      projectName: session.project_name,
      projectRoot: session.project_root,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      archivedAt: session.archived_at,
    })),
    archivedProjects: body.archived_projects.map((project) => ({
      id: project.id,
      kind: project.kind,
      name: project.name,
      rootPath: project.root_path,
      status: project.status,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      archivedAt: project.archived_at,
      sessionCount: project.session_count,
      filesDeleted: project.files_deleted,
    })),
  };
}

export async function fetchSettings(
  token: string,
  base: string = "",
): Promise<SettingsPayload> {
  return request<SettingsPayload>(
    `${base}/api/settings`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
}

export async function updateTranscriptionSettings(
  token: string,
  update: TranscriptionSettingsUpdate,
  base: string = "",
): Promise<SettingsPayload> {
  const query = new URLSearchParams();
  if (update.enabled !== undefined) query.set("enabled", String(update.enabled));
  if (update.provider !== undefined) query.set("provider", update.provider);
  if (update.model !== undefined) query.set("model", update.model);
  if (update.language !== undefined) query.set("language", update.language);
  if (update.maxDurationSec !== undefined) {
    query.set("max_duration_sec", String(update.maxDurationSec));
  }
  if (update.maxUploadMb !== undefined) {
    query.set("max_upload_mb", String(update.maxUploadMb));
  }
  return request<SettingsPayload>(
    `${base}/api/settings/transcription/update?${query}`,
    token,
  );
}

export async function fetchWorkspaces(
  token: string,
  base: string = "",
): Promise<WorkspacesPayload> {
  return request<WorkspacesPayload>(
    `${base}/api/workspaces`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
}

function appendScheduleParams(
  query: URLSearchParams,
  data: {
    name?: string;
    description?: string;
    prompt?: string;
    schedule?: ScheduleConfig;
    skillName?: string;
    workspacePath?: string;
    timezone?: string;
  },
): void {
  if (data.name !== undefined) query.set("name", data.name);
  if (data.description !== undefined) query.set("description", data.description ?? "");
  if (data.prompt !== undefined) query.set("prompt", data.prompt);
  if (data.skillName !== undefined) query.set("skill_name", data.skillName ?? "");
  if (data.workspacePath !== undefined) query.set("workspace_path", data.workspacePath ?? "");
  const timezone = data.timezone ?? data.schedule?.timezone;
  if (timezone !== undefined) query.set("timezone", timezone);
  if (data.schedule !== undefined) {
    query.set("frequency", data.schedule.frequency);
    if (data.schedule.at !== undefined) {
      query.set("at", data.schedule.at);
    }
    if (data.schedule.time) {
      query.set("hour", String(data.schedule.time.hour));
      query.set("minute", String(data.schedule.time.minute));
    }
    if (data.schedule.dayOfWeek !== undefined) {
      query.set("day_of_week", String(data.schedule.dayOfWeek));
    }
    if (data.schedule.dayOfMonth !== undefined) {
      query.set("day_of_month", String(data.schedule.dayOfMonth));
    }
    if (data.schedule.cronExpression !== undefined) {
      query.set("cron_expression", data.schedule.cronExpression);
    }
    if (data.schedule.everyMs !== undefined) {
      query.set("every_ms", String(data.schedule.everyMs));
    }
  }
}

export async function fetchScheduleTasks(
  token: string,
  base: string = "",
): Promise<ScheduleTasksPayload> {
  return request<ScheduleTasksPayload>(
    `${base}/api/schedule/tasks`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
}

export async function createScheduleTask(
  token: string,
  data: {
    name: string;
    description?: string;
    prompt: string;
    schedule: ScheduleConfig;
    skillName?: string;
    workspacePath?: string;
    timezone?: string;
  },
  base: string = "",
): Promise<ScheduleTasksPayload> {
  const query = new URLSearchParams();
  appendScheduleParams(query, data);
  return request<ScheduleTasksPayload>(`${base}/api/schedule/tasks/create?${query}`, token);
}

export async function updateScheduleTask(
  token: string,
  id: string,
  data: {
    name: string;
    description?: string;
    prompt: string;
    schedule: ScheduleConfig;
    skillName?: string;
    workspacePath?: string;
    timezone?: string;
  },
  base: string = "",
): Promise<ScheduleTasksPayload> {
  const query = new URLSearchParams();
  query.set("id", id);
  appendScheduleParams(query, data);
  return request<ScheduleTasksPayload>(`${base}/api/schedule/tasks/update?${query}`, token);
}

export async function deleteScheduleTask(
  token: string,
  id: string,
  base: string = "",
): Promise<ScheduleTasksPayload> {
  const query = new URLSearchParams();
  query.set("id", id);
  return request<ScheduleTasksPayload>(`${base}/api/schedule/tasks/delete?${query}`, token);
}

export async function pauseScheduleTask(
  token: string,
  id: string,
  base: string = "",
): Promise<ScheduleTasksPayload> {
  const query = new URLSearchParams();
  query.set("id", id);
  return request<ScheduleTasksPayload>(`${base}/api/schedule/tasks/pause?${query}`, token);
}

export async function resumeScheduleTask(
  token: string,
  id: string,
  base: string = "",
): Promise<ScheduleTasksPayload> {
  const query = new URLSearchParams();
  query.set("id", id);
  return request<ScheduleTasksPayload>(`${base}/api/schedule/tasks/resume?${query}`, token);
}

export async function runScheduleTaskNow(
  token: string,
  id: string,
  base: string = "",
): Promise<ScheduleTasksPayload> {
  const query = new URLSearchParams();
  query.set("id", id);
  return request<ScheduleTasksPayload>(`${base}/api/schedule/tasks/run?${query}`, token);
}

export async function markScheduleRunViewed(
  token: string,
  taskId: string,
  runId: string,
  base: string = "",
): Promise<ScheduleTasksPayload> {
  const query = new URLSearchParams();
  query.set("task_id", taskId);
  query.set("run_id", runId);
  return request<ScheduleTasksPayload>(`${base}/api/schedule/runs/viewed?${query}`, token);
}

export async function deleteScheduleRun(
  token: string,
  taskId: string,
  runId: string,
  base: string = "",
): Promise<ScheduleTasksPayload> {
  const query = new URLSearchParams();
  query.set("task_id", taskId);
  query.set("run_id", runId);
  return request<ScheduleTasksPayload>(`${base}/api/schedule/runs/delete?${query}`, token);
}

export async function fetchCliApps(
  token: string,
  base: string = "",
): Promise<CliAppsPayload> {
  return request<CliAppsPayload>(
    `${base}/api/settings/cli-apps`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
}

export async function runCliAppAction(
  token: string,
  action: "install" | "update" | "uninstall" | "test",
  name: string,
  base: string = "",
): Promise<CliAppsPayload> {
  const query = new URLSearchParams();
  query.set("name", name);
  return request<CliAppsPayload>(`${base}/api/settings/cli-apps/${action}?${query}`, token);
}

export async function fetchSkills(
  token: string,
  base: string = "",
): Promise<SkillsPayload> {
  return request<SkillsPayload>(
    `${base}/api/settings/skills`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
}

export async function fetchExpertTeams(
  token: string,
  base: string = "",
): Promise<ExpertTeamsPayload> {
  return request<ExpertTeamsPayload>(
    `${base}/api/settings/expert-teams`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
}

export async function fetchExpertTeamDetail(
  token: string,
  id: string,
  base: string = "",
): Promise<ExpertTeamDetail> {
  const query = new URLSearchParams();
  query.set("id", id);
  return request<ExpertTeamDetail>(
    `${base}/api/settings/expert-teams/detail?${query}`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
}

export async function fetchSkillDetail(
  token: string,
  name: string,
  base: string = "",
): Promise<SkillsPayload> {
  const query = new URLSearchParams();
  query.set("name", name);
  return request<SkillsPayload>(
    `${base}/api/settings/skills/detail?${query}`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
}

export async function runSkillAction(
  token: string,
  action: "enable" | "disable" | "delete",
  name: string,
  base: string = "",
): Promise<SkillsPayload> {
  const query = new URLSearchParams();
  query.set("name", name);
  return request<SkillsPayload>(`${base}/api/settings/skills/${action}?${query}`, token);
}

export async function saveSkill(
  token: string,
  name: string,
  content: string,
  base: string = "",
): Promise<SkillsPayload> {
  const query = new URLSearchParams();
  query.set("name", name);
  return request<SkillsPayload>(
    `${base}/api/settings/skills/save?${query}`,
    token,
    { headers: skillValuesHeader({ content }) },
  );
}

export async function fetchPersonalization(
  token: string,
  base: string = "",
): Promise<PersonalizationPayload> {
  return request<PersonalizationPayload>(
    `${base}/api/settings/personalization`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
}

export async function savePersonalization(
  token: string,
  values: { soul?: string; user?: string },
  base: string = "",
): Promise<PersonalizationPayload> {
  return request<PersonalizationPayload>(
    `${base}/api/settings/personalization/save`,
    token,
    { headers: personalizationValuesHeader(values) },
  );
}

export async function restorePersonalization(
  token: string,
  kind: "soul" | "user",
  base: string = "",
): Promise<PersonalizationPayload> {
  const query = new URLSearchParams();
  query.set("kind", kind);
  return request<PersonalizationPayload>(
    `${base}/api/settings/personalization/restore?${query}`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
}

export async function fetchProjectSkills(
  token: string,
  projectPath: string,
  base: string = "",
): Promise<{ project_path: string; skills: string[] }> {
  const query = new URLSearchParams();
  query.set("project_path", projectPath);
  return request<{ project_path: string; skills: string[] }>(
    `${base}/api/settings/project-skills?${query}`,
    token,
  );
}

export async function saveProjectSkills(
  token: string,
  projectPath: string,
  skillNames: string[],
  base: string = "",
): Promise<{ project_path: string; skills: string[] }> {
  const query = new URLSearchParams();
  query.set("project_path", projectPath);
  return request<{ project_path: string; skills: string[] }>(
    `${base}/api/settings/project-skills/save?${query}`,
    token,
    { headers: projectSkillValuesHeader({ skills: skillNames }) },
  );
}

export async function fetchMcpPresets(
  token: string,
  base: string = "",
): Promise<McpPresetsPayload> {
  return request<McpPresetsPayload>(
    `${base}/api/settings/mcp-presets`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
}

export async function requestMcpEditor(
  action: import('./types').McpEditorAction,
  values: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<McpPresetsPayload> {
  const { getNanobotClient } = await import('./nanobotClient');
  const client = getNanobotClient();
  await client.waitUntilReady();
  return client.mcpSettings(action, values, signal);
}

export async function fetchProviderModels(
  token: string,
  provider:
    | string
    | {
        provider: string;
        apiBase?: string;
        apiKey?: string;
        apiType?: "auto" | "chat_completions" | "responses";
      },
  base: string = "",
): Promise<ProviderModelsPayload> {
  const query = new URLSearchParams();
  if (typeof provider === "string") {
    query.set("provider", provider);
  } else {
    query.set("provider", provider.provider);
    if (provider.apiBase !== undefined) query.set("api_base", provider.apiBase);
    if (provider.apiKey !== undefined) query.set("api_key", provider.apiKey);
    if (provider.apiType !== undefined) query.set("api_type", provider.apiType);
  }
  return request<ProviderModelsPayload>(
    `${base}/api/settings/provider-models?${query}`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
}

export async function runMcpPresetAction(
  token: string,
  action: "enable" | "update" | "remove" | "test",
  name: string,
  values: Record<string, string> = {},
  base: string = "",
): Promise<McpPresetsPayload> {
  const query = new URLSearchParams();
  query.set("name", name);
  return request<McpPresetsPayload>(
    `${base}/api/settings/mcp-presets/${action}?${query}`,
    token,
    { headers: mcpValuesHeader(values) },
  );
}

export async function saveCustomMcpServer(
  token: string,
  values: Record<string, string>,
  base: string = "",
): Promise<McpPresetsPayload> {
  return request<McpPresetsPayload>(
    `${base}/api/settings/mcp-presets/custom`,
    token,
    { headers: mcpValuesHeader(values) },
  );
}

export async function importMcpConfig(
  token: string,
  config: string,
  base: string = "",
): Promise<McpPresetsPayload> {
  return request<McpPresetsPayload>(
    `${base}/api/settings/mcp-presets/import`,
    token,
    { headers: mcpValuesHeader({ config }) },
  );
}

export async function updateMcpServerTools(
  token: string,
  name: string,
  enabledTools: string[],
  base: string = "",
): Promise<McpPresetsPayload> {
  return request<McpPresetsPayload>(
    `${base}/api/settings/mcp-presets/tools`,
    token,
    { headers: mcpValuesHeader({ name, enabled_tools: enabledTools }) },
  );
}

export async function listSlashCommands(
  token: string,
  base: string = "",
): Promise<SlashCommand[]> {
  type Row = {
    command: string;
    title: string;
    description: string;
    icon: string;
    arg_hint?: string;
  };
  const body = await request<{ commands: Row[] }>(
    `${base}/api/commands`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
  return body.commands
    .filter((command) => !["/stop", "/restart"].includes(command.command))
    .map((command) => ({
      command: command.command,
      title: command.title,
      description: command.description,
      icon: command.icon,
      argHint: command.arg_hint ?? "",
    }));
}

export async function fetchSidebarState(
  token: string,
  base: string = "",
): Promise<SidebarStatePayload> {
  return request<SidebarStatePayload>(
    `${base}/api/webui/sidebar-state`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
}

export async function updateSidebarState(
  token: string,
  state: SidebarStatePayload,
  base: string = "",
): Promise<SidebarStatePayload> {
  const query = new URLSearchParams();
  query.set("state", JSON.stringify(state));
  return request<SidebarStatePayload>(
    `${base}/api/webui/sidebar-state/update?${query}`,
    token,
  );
}

export async function updateSettings(
  token: string,
  update: SettingsUpdate,
  base: string = "",
): Promise<SettingsPayload> {
  const query = new URLSearchParams();
  if (update.modelPreset !== undefined) {
    query.set("model_preset", update.modelPreset ?? "default");
  }
  if (update.model !== undefined) query.set("model", update.model);
  if (update.provider !== undefined) query.set("provider", update.provider);
  if (update.contextWindowTokens !== undefined) {
    query.set("context_window_tokens", String(update.contextWindowTokens));
  }
  if (update.timezone !== undefined) query.set("timezone", update.timezone);
  if (update.botName !== undefined) query.set("bot_name", update.botName);
  if (update.botIcon !== undefined) query.set("bot_icon", update.botIcon);
  if (update.toolHintMaxLength !== undefined) {
    query.set("tool_hint_max_length", String(update.toolHintMaxLength));
  }
  return request<SettingsPayload>(`${base}/api/settings/update?${query}`, token);
}

export async function createModelConfiguration(
  token: string,
  configuration: ModelConfigurationCreate,
  base: string = "",
): Promise<SettingsPayload> {
  const query = new URLSearchParams();
  if (configuration.name !== undefined) query.set("name", configuration.name);
  query.set("label", configuration.label);
  query.set("provider", configuration.provider);
  query.set("model", configuration.model);
  if (configuration.capabilities?.length) {
    query.set("capabilities", configuration.capabilities.join(","));
  }
  if (configuration.capabilitySource !== undefined) {
    query.set("capability_source", configuration.capabilitySource);
  }
  return request<SettingsPayload>(
    `${base}/api/settings/model-configurations/create?${query}`,
    token,
  );
}

export async function updateModelConfiguration(
  token: string,
  configuration: ModelConfigurationUpdate,
  base: string = "",
): Promise<SettingsPayload> {
  const query = new URLSearchParams();
  query.set("name", configuration.name);
  if (configuration.label !== undefined) query.set("label", configuration.label);
  if (configuration.provider !== undefined) query.set("provider", configuration.provider);
  if (configuration.model !== undefined) query.set("model", configuration.model);
  if (configuration.contextWindowTokens !== undefined) {
    query.set("context_window_tokens", String(configuration.contextWindowTokens));
  }
  if (configuration.capabilities !== undefined) {
    query.set("capabilities", configuration.capabilities.join(","));
  }
  if (configuration.capabilitySource !== undefined) {
    query.set("capability_source", configuration.capabilitySource);
  }
  return request<SettingsPayload>(
    `${base}/api/settings/model-configurations/update?${query}`,
    token,
  );
}

export async function updateModelDefault(
  token: string,
  update: ModelDefaultUpdate,
  base: string = "",
): Promise<SettingsPayload> {
  const query = new URLSearchParams();
  query.set("capability", update.capability);
  query.set("name", update.name);
  return request<SettingsPayload>(
    `${base}/api/settings/model-defaults/update?${query}`,
    token,
  );
}

export async function deleteModelConfiguration(
  token: string,
  name: string,
  base: string = "",
): Promise<SettingsPayload> {
  const query = new URLSearchParams();
  query.set("name", name);
  return request<SettingsPayload>(
    `${base}/api/settings/model-configurations/delete?${query}`,
    token,
  );
}

export async function deleteProviderSettings(
  token: string,
  provider: string,
  base: string = "",
): Promise<SettingsPayload> {
  if (isProtectedBuiltinModelProvider(provider)) {
    throw new Error("系统内置模型服务不能删除");
  }
  const query = new URLSearchParams();
  query.set("provider", provider);
  return request<SettingsPayload>(
    `${base}/api/settings/provider/delete?${query}`,
    token,
  );
}

export async function updateProviderSettings(
  token: string,
  update: ProviderSettingsUpdate,
  base: string = "",
): Promise<SettingsPayload> {
  const query = new URLSearchParams();
  query.set("provider", update.provider);
  if (update.label !== undefined) query.set("label", update.label);
  if (update.apiKey !== undefined) query.set("api_key", update.apiKey);
  if (update.apiBase !== undefined) query.set("api_base", update.apiBase);
  if (update.apiType !== undefined) query.set("api_type", update.apiType);
  return request<SettingsPayload>(
    `${base}/api/settings/provider/update?${query}`,
    token,
  );
}

export async function createProviderSettings(
  token: string,
  create: ProviderSettingsCreate,
  base: string = "",
): Promise<SettingsPayload> {
  const query = new URLSearchParams();
  query.set("name", create.name);
  query.set("api_base", create.apiBase);
  if (create.apiKey !== undefined) query.set("api_key", create.apiKey);
  if (create.apiType !== undefined) query.set("api_type", create.apiType);
  return request<SettingsPayload>(
    `${base}/api/settings/provider/create?${query}`,
    token,
  );
}

export async function loginProviderOAuth(
  token: string,
  provider: string,
  base: string = "",
): Promise<SettingsPayload> {
  const query = new URLSearchParams();
  query.set("provider", provider);
  return request<SettingsPayload>(
    `${base}/api/settings/provider/oauth-login?${query}`,
    token,
  );
}

export async function logoutProviderOAuth(
  token: string,
  provider: string,
  base: string = "",
): Promise<SettingsPayload> {
  const query = new URLSearchParams();
  query.set("provider", provider);
  return request<SettingsPayload>(
    `${base}/api/settings/provider/oauth-logout?${query}`,
    token,
  );
}

export async function updateWebSearchSettings(
  token: string,
  update: WebSearchSettingsUpdate,
  base: string = "",
): Promise<SettingsPayload> {
  const query = new URLSearchParams();
  query.set("provider", update.provider);
  if (update.apiKey !== undefined) query.set("api_key", update.apiKey);
  if (update.baseUrl !== undefined) query.set("base_url", update.baseUrl);
  if (update.maxResults !== undefined) query.set("max_results", String(update.maxResults));
  if (update.timeout !== undefined) query.set("timeout", String(update.timeout));
  if (update.useJinaReader !== undefined) {
    query.set("use_jina_reader", String(update.useJinaReader));
  }
  return request<SettingsPayload>(
    `${base}/api/settings/web-search/update?${query}`,
    token,
  );
}

export async function updateNetworkSafetySettings(
  token: string,
  update: NetworkSafetySettingsUpdate,
  base: string = "",
): Promise<SettingsPayload> {
  const query = new URLSearchParams();
  query.set("webui_allow_local_service_access", String(update.webuiAllowLocalServiceAccess));
  query.set("webui_default_access_mode", update.webuiDefaultAccessMode);
  return request<SettingsPayload>(
    `${base}/api/settings/network-safety/update?${query}`,
    token,
  );
}

export interface SecurityAuditQuery {
  search?: string;
  category?: string;
  result?: string;
  startMs?: number;
  endMs?: number;
  cursor?: number;
  limit?: number;
  includeTotal?: boolean;
}

function securityAuditQuery(query: SecurityAuditQuery = {}): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.category) params.set("category", query.category);
  if (query.result) params.set("result", query.result);
  if (query.startMs !== undefined) params.set("start_ms", String(query.startMs));
  if (query.endMs !== undefined) params.set("end_ms", String(query.endMs));
  if (query.cursor !== undefined) params.set("cursor", String(query.cursor));
  if (query.includeTotal !== undefined) params.set("include_total", query.includeTotal ? "1" : "0");
  params.set("limit", String(query.limit ?? 100));
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export async function fetchSecurityPolicy(
  token: string,
  base: string,
): Promise<SecurityPolicyPayload> {
  return request<SecurityPolicyPayload>(`${base}/api/security/policy`, token, { cache: "no-store" }, API_READ_TIMEOUT_MS);
}

export async function updateSecurityPolicy(
  token: string,
  base: string,
  values: SecurityPolicyUpdate,
): Promise<SecurityPolicyPayload> {
  return request<SecurityPolicyPayload>(`${base}/api/security/policy/update`, token, {
    cache: "no-store",
    headers: { "X-Nanobot-Security-Values": asciiJsonStringify(values) },
  }, API_READ_TIMEOUT_MS);
}

export async function resetSecurityPolicy(
  token: string,
  base: string,
): Promise<SecurityPolicyPayload> {
  return request<SecurityPolicyPayload>(`${base}/api/security/policy/reset`, token, { cache: "no-store" });
}

export async function fetchSecurityAudit(
  token: string,
  base: string,
  query: SecurityAuditQuery = {},
): Promise<SecurityAuditPage> {
  return request<SecurityAuditPage>(`${base}/api/security/audit${securityAuditQuery(query)}`, token, { cache: "no-store" }, API_READ_TIMEOUT_MS);
}

export async function exportSecurityAudit(
  token: string,
  base: string,
  query: SecurityAuditQuery = {},
): Promise<Uint8Array> {
  const response = await fetchGatewayResponse(
    `${base}/api/security/audit/export${securityAuditQuery(query)}`,
    token,
  );
  if (!response.ok) throw new ApiError(response.status, (await response.text()).trim() || `HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function clearSecurityAudit(token: string, base: string): Promise<{ deleted: number }> {
  return request<{ deleted: number }>(`${base}/api/security/audit/clear`, token, { cache: "no-store" });
}

export async function updateImageGenerationSettings(
  token: string,
  update: ImageGenerationSettingsUpdate,
  base: string = "",
): Promise<SettingsPayload> {
  const query = new URLSearchParams();
  query.set("enabled", String(update.enabled));
  query.set("provider", update.provider);
  query.set("model", update.model);
  query.set("default_aspect_ratio", update.defaultAspectRatio);
  query.set("default_image_size", update.defaultImageSize);
  query.set("max_images_per_turn", String(update.maxImagesPerTurn));
  return request<SettingsPayload>(
    `${base}/api/settings/image-generation/update?${query}`,
    token,
  );
}
