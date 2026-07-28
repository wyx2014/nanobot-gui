import type {
  ChatSummary,
  CliAppsPayload,
  ExpertTeamDetail,
  ExpertTeamsPayload,
  ImageGenerationSettingsUpdate,
  McpPresetsPayload,
  ModelConfigurationCreate,
  ModelConfigurationUpdate,
  NetworkSafetySettingsUpdate,
  ProviderSettingsCreate,
  ProviderModelsPayload,
  ProviderSettingsUpdate,
  ProjectPayload,
  ProjectMemoriesPayload,
  ProjectMemoryJobPayload,
  ProjectMemoryPayload,
  ProjectMemorySourcePayload,
  ProjectMemoryStatusPayload,
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
  ThreadRuntimeSnapshot,
  TurnPlanResource,
  WorkspaceScopePayload,
} from "./types";
import type { ScheduleConfig } from "@/types/schedule";
import { fetchWithTimeout } from "./bootstrap";

const API_READ_TIMEOUT_MS = 20_000;

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
  const execute = (currentToken: string) => fetchWithTimeout(
    url,
    {
      ...(init ?? {}),
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${currentToken}`,
      },
      credentials: "same-origin",
    },
    timeoutMs,
  );

  let res = await execute(token);
  if (res.status !== 401 || !tokenProvider) return res;

  try {
    const refreshedToken = await tokenProvider();
    res = await execute(refreshedToken);
  } catch (refreshErr) {
    console.error("Token refresh failed during 401 retry:", refreshErr);
  }
  return res;
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
    const text = typeof res.text === "function" ? await res.text() : "";
    const isHtml = text.trimStart().toLowerCase().startsWith("<!doctype");
    throw new ApiError(
      res.status,
      isHtml
         ? "Gateway returned WebUI HTML instead of JSON. Restart nanobot gateway and try again."
        : "Gateway returned a non-JSON response.",
    );
  }
  return (await res.json()) as T;
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
  return { "X-Nanobot-MCP-Values": JSON.stringify(payload) };
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

function mapProjectMemoryJob(value: Record<string, unknown> | null): ProjectMemoryJobPayload | null {
  if (!value) return null;
  return {
    status: String(value.status ?? "unknown"),
    attemptCount: Number(value.attempt_count ?? 0),
    inputWatermark: value.input_watermark == null ? null : Number(value.input_watermark),
    completedWatermark: value.completed_watermark == null ? null : Number(value.completed_watermark),
    updatedAt: Number(value.updated_at ?? 0),
    completedAt: value.completed_at == null ? null : Number(value.completed_at),
    error: (value.error as ProjectMemoryJobPayload["error"]) ?? null,
  };
}

function mapProjectMemoryStatus(value: Record<string, unknown>): ProjectMemoryStatusPayload {
  return {
    projectId: String(value.project_id ?? ""),
    inputWatermark: Number(value.input_watermark ?? 0),
    phase1: mapProjectMemoryJob((value.phase1 as Record<string, unknown> | null) ?? null),
    phase2: mapProjectMemoryJob((value.phase2 as Record<string, unknown> | null) ?? null),
  };
}

function mapProjectMemorySource(value: Record<string, unknown>): ProjectMemorySourcePayload {
  return {
    id: String(value.id ?? ""),
    stage1Id: value.stage1_id == null ? null : String(value.stage1_id),
    sourceSessionId: String(value.source_session_id ?? ""),
    sourceSessionKey: value.source_session_key == null ? null : String(value.source_session_key),
    sourceTurnId: value.source_turn_id == null ? null : String(value.source_turn_id),
    sourceEventId: value.source_event_id == null ? null : String(value.source_event_id),
    evidenceLocator: value.evidence_locator == null ? null : String(value.evidence_locator),
    createdAt: Number(value.created_at ?? 0),
  };
}

export async function listProjectMemories(
  token: string,
  projectId: string,
  base: string = "",
): Promise<ProjectMemoriesPayload> {
  const body = await request<{
    project_id: string;
    memories: Array<Record<string, unknown>>;
    status: Record<string, unknown>;
    retrieval: { mode: "bounded_lexical"; deep_rag_enabled: false };
  }>(
    `${base}/api/projects/${encodeURIComponent(projectId)}/memories`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
  const memories: ProjectMemoryPayload[] = body.memories.map((value) => ({
    id: String(value.id ?? ""),
    projectId: String(value.project_id ?? ""),
    kind: String(value.kind ?? "reference"),
    title: String(value.title ?? ""),
    content: String(value.content ?? ""),
    confidence: value.confidence == null ? null : Number(value.confidence),
    status: String(value.status ?? "active"),
    usageCount: Number(value.usage_count ?? 0),
    lastUsedAt: value.last_used_at == null ? null : Number(value.last_used_at),
    createdAt: Number(value.created_at ?? 0),
    updatedAt: Number(value.updated_at ?? 0),
    sources: Array.isArray(value.sources)
      ? value.sources.map((source) => mapProjectMemorySource(source as Record<string, unknown>))
      : [],
  }));
  return {
    projectId: body.project_id,
    memories,
    status: mapProjectMemoryStatus(body.status),
    retrieval: {
      mode: body.retrieval.mode,
      deepRagEnabled: body.retrieval.deep_rag_enabled,
    },
  };
}

export async function consolidateProjectMemories(
  token: string,
  projectId: string,
  base: string = "",
): Promise<{ refreshed: boolean; status: ProjectMemoryStatusPayload }> {
  const body = await request<{
    refreshed: boolean;
    status: Record<string, unknown>;
  }>(
    `${base}/api/projects/${encodeURIComponent(projectId)}/memories/consolidate`,
    token,
  );
  return {
    refreshed: body.refreshed,
    status: mapProjectMemoryStatus(body.status),
  };
}

export async function forgetProjectMemory(
  token: string,
  projectId: string,
  memoryId: string,
  base: string = "",
): Promise<boolean> {
  const body = await request<{ ok: boolean }>(
    `${base}/api/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memoryId)}/forget`,
    token,
  );
  return body.ok;
}

export async function clearProjectMemories(
  token: string,
  projectId: string,
  base: string = "",
): Promise<number> {
  const body = await request<{ removed: number }>(
    `${base}/api/projects/${encodeURIComponent(projectId)}/memories/clear`,
    token,
  );
  return body.removed;
}

export async function reindexProjectMemories(
  token: string,
  projectId: string,
  base: string = "",
): Promise<{ artifactsSeen: number; indexed: number; skipped: number; missing: number }> {
  const body = await request<{
    artifacts_seen: number;
    indexed: number;
    skipped: number;
    missing: number;
  }>(
    `${base}/api/projects/${encodeURIComponent(projectId)}/memories/reindex`,
    token,
  );
  return {
    artifactsSeen: body.artifacts_seen,
    indexed: body.indexed,
    skipped: body.skipped,
    missing: body.missing,
  };
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
  if (options.limit != null) query.set("limit", String(options.limit));
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

export async function deleteSession(
  token: string,
  key: string,
  base: string = "",
): Promise<boolean> {
  const body = await request<{ deleted: boolean }>(
    `${base}/api/sessions/${encodeURIComponent(key)}/delete`,
    token,
  );
  return body.deleted;
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
  if (data.timezone !== undefined) query.set("timezone", data.timezone);
  if (data.schedule !== undefined) {
    query.set("frequency", data.schedule.frequency);
    if (data.schedule.time) {
      query.set("hour", String(data.schedule.time.hour));
      query.set("minute", String(data.schedule.time.minute));
    }
    if (data.schedule.dayOfWeek !== undefined) {
      query.set("day_of_week", String(data.schedule.dayOfWeek));
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
  action: "enable" | "remove" | "test",
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
  return request<SettingsPayload>(
    `${base}/api/settings/model-configurations/update?${query}`,
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
