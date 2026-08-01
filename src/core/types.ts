export type Role = "user" | "assistant" | "tool" | "system";

import type { ScheduledTask } from "@/types/schedule";

export type TurnLifecycleStatus =
  | "queued"
  | "inProgress"
  | "completed"
  | "failed"
  | "interrupted";

export type TurnPlanStatus =
  | "created"
  | "pending"
  | "inProgress"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export interface TurnPlanStepResource {
  id: string;
  key?: string;
  ordinal?: number;
  title: string;
  detail?: string;
  kind?: "goal" | "member" | "synthesis" | "audit" | "delivery" | string;
  stage_key?: string;
  status: TaskProgressStatus | "inProgress" | "failed" | "cancelled";
  warning?: string;
  started_at?: number;
  ended_at?: number;
  updated_at?: number;
}

export interface TurnPlanResource {
  id: string;
  project_id?: string;
  session_id?: string;
  turn_id: string;
  kind: "dynamic" | "workflow";
  owner: string;
  policy: "optional" | "required";
  execution: "serial" | "parallel" | "staged";
  status: TurnPlanStatus;
  revision: number;
  signature_version?: number;
  active_step_ids: string[];
  current_step_id?: string | null;
  note?: string | null;
  steps: TurnPlanStepResource[];
  created_at?: number;
  updated_at?: number;
  terminalized_at?: number;
  terminalization_reason?: string;
  stage_key?: string;
  team_id?: string;
  team_run_id?: string;
}

export interface TurnLifecycleResource {
  id: string;
  runtime_epoch?: string | null;
  project_id?: string | null;
  session_id?: string | null;
  status: TurnLifecycleStatus;
  started_at: number;
  completed_at?: number | null;
  duration_ms?: number | null;
  finish_reason?: string | null;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    estimated_tokens?: number;
    cached_tokens?: number;
    cache_read_input_tokens?: number;
    confirmed_new_tokens?: number;
    new_tokens?: number;
  };
  plan?: TurnPlanResource;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
}

export type ThreadRuntimeStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "active"; active_flags?: string[] }
  | { type: "systemError"; error_code?: string };

export interface ThreadRuntimeSnapshot {
  session_key: string;
  project_id?: string;
  session_id?: string;
  runtime_epoch: string | null;
  snapshot_revision: number;
  thread_status: ThreadRuntimeStatus;
  active_turn: TurnLifecycleResource | null;
  latest_turn: TurnLifecycleResource | null;
}

/** "trace" rows are intermediate agent breadcrumbs (tool-call hints,
 * progress pings) that should not be rendered as conversational replies. */
export type MessageKind = "message" | "trace";

/** One image attached to a UIMessage. */
export interface UIImage {
  url?: string;
  name?: string;
}

export type UIMediaKind = "image" | "video" | "file";

export interface UIMediaAttachment {
  kind: UIMediaKind;
  id?: string;
  url?: string;
  download_url?: string;
  local_path?: string;
  name?: string;
  mime_type?: string;
  size?: number;
}

export interface UIMessage {
  id: string;
  role: Role;
  content: string;
  kind?: MessageKind;
  isStreaming?: boolean;
  createdAt: number;
  /** For trace rows: each individual hint line, so consecutive hints can
   * render as a single collapsible group. */
  traces?: string[];
  /** Structured tool events behind trace rows. Kept so activity cards can
   * distinguish running, completed, and failed tool phases. */
  toolEvents?: ToolProgressEvent[];
  /** Structured rich UI event emitted by nanobot, e.g. task progress. */
  agentUI?: AgentUIBlob;
  /** Activity rows: explicit file edits emitted by edit tools. */
  fileEdits?: UIFileEdit[];
  /** Activity rows created during the same agent phase share one collapsible block. */
  activitySegmentId?: string;
  /** Public, user-facing explanation of the next action. Unlike ``reasoning``,
   * this text is safe to render verbatim inside the Steps timeline. */
  narration?: string;
  /** True while ``narration_delta`` frames are still extending this row. */
  narrationStreaming?: boolean;
  /** Transport identities retained while a provisional answer stream is
   * reclassified as narration. They are not rendered. */
  streamId?: string;
  narrationStreamId?: string;
  /** User turn: optimistic blob URLs for preview. Replay: placeholder chips. */
  images?: UIImage[];
  /** Signed or local UI-renderable media attachments. */
  media?: UIMediaAttachment[];
  /** App-specific CLI adapters explicitly attached to this user turn. */
  cliApps?: UICliAppAttachment[];
  /** Settings-managed MCP presets explicitly attached to this user turn. */
  mcpPresets?: UIMcpPresetAttachment[];
  /** Assistant turn: accumulated model reasoning / thinking text. Built up
   * incrementally from ``reasoning_delta`` frames; finalized when
   * ``reasoning_end`` arrives. */
  reasoning?: string;
  /** True while ``reasoning_delta`` frames are still arriving for this turn.
   * Drives the shimmer header on ``ReasoningBubble``. */
  reasoningStreaming?: boolean;
  /** Segment timestamps are separate from whole-turn latency. Once
   * ``reasoning_end`` arrives, the duration is frozen even while tools run. */
  reasoningStartedAt?: number;
  reasoningCompletedAt?: number;
  reasoningDurationMs?: number;
  /** End-to-end wall time for this assistant turn (persisted ``latency_ms`` / ``turn_end``). */
  latencyMs?: number;
  /** Authoritative wall-clock time when this turn reached a terminal state. */
  completedAt?: number;
  /** Per-turn provider token usage, normalized for renderer consumption. */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  /** Assistant turn: structured interactive prompt card persisted in transcript. */
  interactivePrompt?: UIInteractivePrompt;
  /** User turn: structured answer metadata for an interactive prompt. */
  interactivePromptAnswer?: UIInteractivePromptAnswer;
}

export interface UICliAppAttachment {
  name: string;
  display_name?: string;
  category?: string;
  entry_point?: string;
  logo_url?: string | null;
  brand_color?: string | null;
}

export interface UIMcpPresetAttachment {
  name: string;
  display_name?: string;
  category?: string;
  transport?: string;
  status?: string;
  configured?: boolean;
  logo_url?: string | null;
  brand_color?: string | null;
}

export type UIInteractivePromptStatus = "pending" | "answered" | "skipped" | "expired";

export interface UIInteractivePromptOption {
  id: string;
  label: string;
  description?: string;
}

export interface UIInteractivePromptQuestion {
  id: string;
  question: string;
  options: UIInteractivePromptOption[];
  allowFreeform?: boolean;
  answeredOptionId?: string;
  answeredText?: string;
}

export interface UIInteractivePrompt {
  promptId: string;
  title?: string;
  question: string;
  options: UIInteractivePromptOption[];
  questions?: UIInteractivePromptQuestion[];
  allowFreeform?: boolean;
  allowSkip?: boolean;
  stepIndex?: number;
  totalSteps?: number;
  status: UIInteractivePromptStatus;
  answeredOptionId?: string;
  answeredText?: string;
}

export interface UIInteractivePromptAnswer {
  promptId: string;
  answerType: "option" | "freeform" | "skip" | "group";
  optionId?: string;
  answers?: Array<{
    questionId: string;
    answerType: "option" | "freeform";
    optionId?: string;
    text: string;
  }>;
}

/** Structured UI blob on ``progress`` WS frames; channels may add more ``kind`` values later. */
export type TaskProgressStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "skipped"
  | "interrupted";

export interface TaskProgressStep {
  id: string;
  title: string;
  detail?: string;
  status: TaskProgressStatus;
}

export type AgentUIBlob =
  | {
      kind: "task_progress";
      steps: TaskProgressStep[];
      plan_id?: string;
      turn_id?: string;
      plan_kind?: "dynamic" | "workflow";
      owner?: string;
      policy?: "optional" | "required";
      execution?: "serial" | "parallel" | "staged";
      status?: TurnPlanStatus;
      revision?: number;
      active_step_ids?: string[];
      /** Optional public progress note; never contains private reasoning. */
      note?: string;
      current_step_id?: string;
      /** Display label retained for lifecycle events that only carry a team id. */
      team_name?: string;
      /** Stable team identity for progress updates that arrive without a usable run id. */
      team_id?: string;
      /** Current team run identity, when supplied by the gateway. */
      team_run_id?: string;
    }
  | {
      kind: string;
      data?: unknown;
      [key: string]: unknown;
    };

/** WebSocket snapshot for sustained goals (`goal_state` events; keyed by ``chat_id``). */
export interface GoalStateWsPayload {
  active: boolean;
  ui_summary?: string;
  objective?: string;
}

export interface ToolProgressEvent {
  version?: number;
  phase?: "start" | "end" | "error" | string;
  call_id?: string;
  name?: string;
  /** Stable ordering within one agent turn. */
  sequence?: number;
  /** Calls emitted by the same model response share a batch id. */
  batch_id?: string;
  /** Gateway event time in Unix milliseconds. */
  occurred_at?: number;
  display?: {
    category?: string;
    title?: string;
    detail?: string;
    subject?: string;
    importance?: "primary" | "secondary" | string;
  };
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  files?: unknown[];
  embeds?: unknown[];
}

export interface UIFileEdit {
  version?: number;
  call_id: string;
  tool: string;
  path: string;
  absolute_path?: string;
  phase?: "start" | "end" | "error" | string;
  added: number;
  deleted: number;
  approximate?: boolean;
  status: "editing" | "done" | "error";
  operation?: "edit" | "delete" | string;
  binary?: boolean;
  error?: string;
  pending?: boolean;
}

export interface ChatSummary {
  /** Server-side session key, e.g. ``websocket:abcd-...``. */
  key: string;
  /** Local channel + chat_id parts derived from ``key`` for convenience. */
  channel: string;
  chatId: string;
  /** Stable SQLite projection identities returned by the gateway. */
  sessionId?: string;
  projectId?: string;
  createdAt: string | null;
  updatedAt: string | null;
  title?: string;
  preview: string;
  /** Unix epoch seconds when this session currently has a turn in flight. */
  runStartedAt?: number | null;
  workspaceScope?: WorkspaceScopePayload | null;
  expertTeam?: ExpertTeamBinding | null;
}

export interface ProjectPayload {
  id: string;
  kind: "workspace" | "inbox" | "legacy_quarantine";
  name: string;
  rootPath: string;
  status: "active" | "missing" | "detached" | "archived";
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSessionPayload {
  id: string;
  projectId: string;
  sessionKey: string;
  title: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectMemorySourcePayload {
  id: string;
  stage1Id?: string | null;
  sourceSessionId: string;
  sourceSessionKey?: string | null;
  sourceTurnId?: string | null;
  sourceEventId?: string | null;
  evidenceLocator?: string | null;
  createdAt: number;
}

export interface ProjectMemoryPayload {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  content: string;
  confidence?: number | null;
  status: string;
  usageCount: number;
  lastUsedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  sources: ProjectMemorySourcePayload[];
}

export interface ProjectMemoryJobPayload {
  status: string;
  attemptCount: number;
  inputWatermark?: number | null;
  completedWatermark?: number | null;
  updatedAt: number;
  completedAt?: number | null;
  error?: { code?: string; message?: string; retryable?: boolean } | null;
}

export interface ProjectMemoryStatusPayload {
  projectId: string;
  inputWatermark: number;
  phase1?: ProjectMemoryJobPayload | null;
  phase2?: ProjectMemoryJobPayload | null;
}

export interface ProjectMemoriesPayload {
  projectId: string;
  memories: ProjectMemoryPayload[];
  status: ProjectMemoryStatusPayload;
  retrieval: {
    mode: "bounded_lexical";
    deepRagEnabled: false;
  };
}

export type WorkspaceAccessMode = "restricted" | "full";
export type WebuiDefaultAccessMode = "default" | "full";

export interface WorkspaceScopePayload {
  project_path: string;
  project_name?: string;
  access_mode: WorkspaceAccessMode;
  restrict_to_workspace?: boolean;
  sandbox_status?: {
    restrict_to_workspace: boolean;
    workspace_root: string;
    level: string;
    enforced: boolean;
    provider: string;
    provider_label: string;
    summary: string;
  };
}

export interface WorkspacesPayload {
  schema_version: number;
  default_access_mode: WebuiDefaultAccessMode;
  default_scope: WorkspaceScopePayload;
  controls: {
    can_change_project: boolean;
    can_use_full_access: boolean;
  };
}

export interface ScheduleTasksPayload {
  tasks: ScheduledTask[];
  status?: {
    enabled: boolean;
    jobs: number;
    next_wake_at_ms?: number | null;
  };
}

export type SidebarDensity = "comfortable" | "compact";
export type SidebarSortMode = "updated_desc" | "created_desc" | "title_asc";

export interface SidebarViewState {
  density: SidebarDensity;
  show_previews: boolean;
  show_timestamps: boolean;
  show_archived: boolean;
  sort: SidebarSortMode;
}

export interface SidebarStatePayload {
  schema_version: number;
  pinned_keys: string[];
  archived_keys: string[];
  title_overrides: Record<string, string>;
  project_name_overrides: Record<string, string>;
  tags_by_key: Record<string, string[]>;
  collapsed_groups: Record<string, boolean>;
  view: SidebarViewState;
  updated_at?: string | null;
}

export interface BootstrapResponse {
  token: string;
  ws_path: string;
  ws_url?: string | null;
  expires_in: number;
  model_name?: string | null;
  agent_ready?: boolean;
  mcp_status?: "disabled" | "pending" | "warming" | "ready" | "unavailable" | "unknown";
  runtime_surface?: RuntimeSurface;
  runtime_capabilities?: RuntimeCapabilities;
}

export type RuntimeSurface = "browser" | "native";
export type RestartBehavior = "none" | "nextTurn" | "engineRestart" | "appRestart";
export type SettingsApplyStatus =
  | "idle"
  | "pending"
  | "applying"
  | "restarting_engine"
  | "requires_app_restart";

export interface RuntimeCapabilities {
  can_restart_engine: boolean;
  can_pick_folder: boolean;
  can_open_logs: boolean;
  can_export_diagnostics: boolean;
}

export interface ProviderModelInfo {
  id: string;
  label?: string | null;
  owned_by?: string | null;
  context_window?: number | null;
}

export interface ProviderModelsPayload {
  provider: string;
  label: string;
  status:
    | "available"
    | "unsupported"
    | "not_configured"
    | "missing_api_base"
    | "error";
  catalog_kind: "official" | "catalog" | "local" | "custom" | "unsupported";
  models: ProviderModelInfo[];
  model_count: number;
  message?: string | null;
  fetched_at?: number;
}

export type ModelCapability =
  | "text"
  | "speech_to_text";

export interface SettingsPayload {
  surface?: RuntimeSurface;
  runtime_surface?: RuntimeSurface;
  runtime_capabilities?: RuntimeCapabilities;
  apply_state?: {
    status: SettingsApplyStatus;
    sections: string[];
  };
  restart_behavior_by_section?: Record<string, RestartBehavior>;
  agent: {
    model: string;
    provider: string;
    resolved_provider: string | null;
    has_api_key: boolean;
    model_preset: string | null;
    max_tokens: number;
    context_window_tokens: number;
    temperature: number;
    reasoning_effort: string | null;
    timezone: string;
    bot_name: string;
    bot_icon: string;
    tool_hint_max_length: number;
  };
  model_presets: Array<{
    name: string;
    label: string;
    active: boolean;
    is_default: boolean;
    model: string;
    provider: string;
    max_tokens: number;
    context_window_tokens: number;
    temperature: number;
    reasoning_effort: string | null;
    capabilities: ModelCapability[];
  }>;
  model_defaults: Record<ModelCapability, string | null>;
  providers: Array<{
    name: string;
    label: string;
    configured: boolean;
    auth_type?: "api_key" | "oauth";
    api_key_required?: boolean;
    api_key_hint?: string | null;
    api_base?: string | null;
    default_api_base?: string | null;
    api_type?: "auto" | "chat_completions" | "responses";
    custom?: boolean;
    oauth_account?: string | null;
    oauth_expires_at?: number | null;
    oauth_login_supported?: boolean;
  }>;
  web_search: {
    provider: string;
    api_key_hint?: string | null;
    base_url?: string | null;
    max_results: number;
    timeout: number;
    providers: Array<{
      name: string;
      label: string;
      credential: "none" | "api_key" | "base_url";
    }>;
  };
  web: {
    enable: boolean;
    proxy?: string | null;
    user_agent?: string | null;
    search: {
      max_results: number;
      timeout: number;
    };
    fetch: {
      use_jina_reader: boolean;
    };
  };
  image_generation: {
    enabled: boolean;
    provider: string;
    provider_configured: boolean;
    model: string;
    default_aspect_ratio: string;
    default_image_size: string;
    max_images_per_turn: number;
    save_dir: string;
    providers: Array<{
      name: string;
      label: string;
      configured: boolean;
      auth_type?: "api_key" | "oauth";
      api_key_hint?: string | null;
      api_base?: string | null;
      default_api_base?: string | null;
    }>;
  };
  transcription: {
    enabled: boolean;
    provider: string;
    provider_configured: boolean;
    model: string;
    language?: string | null;
    max_duration_sec: number;
    max_upload_mb: number;
    providers: Array<{
      name: string;
      label: string;
      configured: boolean;
      api_key_hint?: string | null;
      api_base?: string | null;
      default_api_base?: string | null;
    }>;
    streaming?: {
      supported: boolean;
      profile?: string | null;
      upstream_model?: string | null;
      batch_fallback?: boolean;
    };
  };
  runtime: {
    config_path: string;
    workspace_path: string;
    gateway_host: string;
    gateway_port: number;
    heartbeat: {
      enabled: boolean;
      interval_s: number;
      keep_recent_messages: number;
    };
    dream: {
      schedule: string;
    };
    unified_session: boolean;
  };
  advanced: {
    restrict_to_workspace: boolean;
    workspace_sandbox?: {
      restrict_to_workspace: boolean;
      workspace_root: string;
      level: "off" | "application" | "system" | string;
      enforced: boolean;
      provider: string;
      provider_label: string;
      summary: string;
    };
    ssrf_whitelist_count: number;
    webui_allow_local_service_access: boolean;
    allow_local_preview_access?: boolean;
    webui_default_access_mode: WebuiDefaultAccessMode;
    private_service_protection_enabled: boolean;
    mcp_server_count: number;
    exec_enabled: boolean;
    exec_sandbox?: string | null;
    exec_path_append_set: boolean;
  };
  requires_restart: boolean;
  restart_required_sections?: Array<"runtime" | "browser" | "image">;
}

export interface AppPackageRef {
  manager: string;
  name?: string;
}

export interface AppCapability {
  type: "cli" | "mcp" | "skill" | string;
  entry_point?: string;
  package?: AppPackageRef;
  path?: string;
  transport?: string;
  command?: string;
  args?: string[];
  url?: string;
  fields?: Array<{
    name: string;
    target?: string;
    required?: boolean;
    secret?: boolean;
    env_var?: string | null;
  }>;
}

export interface AppPlan {
  supported: boolean;
  strategy?: string;
  managed_paths?: string[];
  verification?: string[];
}

export interface AppTrust {
  registry: string;
  level: string;
  review_status: string;
}

export interface AppManifest {
  schema: "agent-app.v1" | string;
  id: string;
  display_name: string;
  version?: string;
  description: string;
  category: string;
  source: string;
  logo_url?: string | null;
  brand_color?: string | null;
  docs_url?: string | null;
  capabilities: AppCapability[];
  install: AppPlan;
  remove: AppPlan;
  trust: AppTrust;
}

export interface CliAppInfo {
  name: string;
  display_name: string;
  category: string;
  description: string;
  requires: string;
  source: string;
  entry_point: string;
  install_supported: boolean;
  installed: boolean;
  available: boolean;
  status: "installed" | "missing" | "available" | "unsupported" | "not_installed" | string;
  logo_url?: string | null;
  brand_color?: string | null;
  skill_installed: boolean;
  manifest?: AppManifest;
}

export interface CliAppsPayload {
  apps: CliAppInfo[];
  installed_count: number;
  catalog_updated_at?: string | null;
  last_action?: {
    ok: boolean;
    message: string;
    installed?: boolean;
    removed?: boolean;
    output?: string | null;
    still_available?: boolean;
    verification?: string[];
    verification_failed?: string[];
  };
}

export interface NanobotSkillInfo {
  name: string;
  description: string;
  path: string;
  source: "builtin" | "workspace" | string;
  enabled: boolean;
  available: boolean;
  missing: string;
  user_invocable: boolean;
  always: boolean;
  tags: string[];
  metadata?: Record<string, unknown>;
  content?: string;
}

export interface SkillsPayload {
  skills: NanobotSkillInfo[];
  disabled: string[];
  installed_count: number;
  last_action?: {
    ok: boolean;
    message: string;
  };
}

export interface ExpertTeamBinding {
  id: string;
  name?: string;
  version?: string;
  member_count?: number;
}

export interface ExpertTeamMember {
  id: string;
  name: string;
  framework?: string;
  description?: string;
  phase?: string;
  phase_label?: string;
}

export interface ExpertTeamWorkflow {
  id: string;
  name: string;
  description?: string;
  mode: "team" | "lead";
  featured: boolean;
}

export interface ExpertTeamSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  available: boolean;
  unavailable_reason?: string;
  cover?: string;
  member_count: number;
  workflow_count: number;
  data_source_count?: number;
  tags: string[];
  requested_concurrency: number;
}

export interface ExpertTeamDataSource {
  id: string;
  name: string;
  skill: string;
  priority: "primary" | "supplemental";
  required: boolean;
  description?: string;
  assignments: Record<string, string>;
}

export interface ExpertTeamMcpPreset {
  name: string;
  display_name: string;
  required: boolean;
  configured: boolean;
  description?: string;
}

export interface ExpertTeamDetail extends ExpertTeamSummary {
  members: ExpertTeamMember[];
  workflows: ExpertTeamWorkflow[];
  data_sources?: ExpertTeamDataSource[];
  mcp_presets?: ExpertTeamMcpPreset[];
  optional_dependencies: Array<{
    name: string;
    available: boolean;
    reason?: string;
  }>;
  source_available: boolean;
}

export interface ExpertTeamsPayload {
  teams: ExpertTeamSummary[];
}

export interface McpPresetField {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  configured: boolean;
  placeholder?: string;
  env_var?: string | null;
}

export interface McpPresetInfo {
  name: string;
  display_name: string;
  category: string;
  description: string;
  docs_url: string;
  transport: "stdio" | "streamableHttp" | "sse" | "oauth" | string;
  requires: string;
  note: string;
  install_supported: boolean;
  installed: boolean;
  configured: boolean;
  available: boolean;
  status: "not_installed" | "configured" | "missing_credentials" | "missing_dependency" | "coming_soon" | string;
  logo_url?: string | null;
  brand_color?: string | null;
  required_fields: McpPresetField[];
  connection_summary: string;
  connection?: {
    transport: "stdio" | "streamableHttp" | "sse" | string;
    command: string;
    args: string[];
    cwd: string;
    url: string;
    tool_timeout: number;
    has_env: boolean;
    has_headers: boolean;
  };
  tool_count?: number;
  tool_names?: string[];
  checked_at?: string | null;
  error?: string | null;
  enabled_tools?: string[];
  source?: "preset" | "custom" | string;
  manifest?: AppManifest;
}

export interface McpPresetsPayload {
  presets: McpPresetInfo[];
  installed_count: number;
  requires_restart?: boolean;
  hot_reload?: {
    ok: boolean;
    message: string;
    added?: string[];
    changed?: string[];
    removed?: string[];
    retried?: string[];
    connected?: string[];
    configured?: string[];
    failed?: string[];
    tools_removed?: number;
    requires_restart?: boolean;
  };
  last_action?: {
    ok: boolean;
    message: string;
    installed?: boolean;
    removed?: boolean;
    managed_paths_removed?: string[];
    verification?: string[];
    verification_failed?: string[];
    tool_count?: number;
    tool_names?: string[];
    checked_at?: string | null;
    error?: string | null;
  };
}

export interface SettingsUpdate {
  model?: string;
  provider?: string;
  modelPreset?: string | null;
  contextWindowTokens?: number;
  timezone?: string;
  botName?: string;
  botIcon?: string;
  toolHintMaxLength?: number;
}

export interface ModelConfigurationCreate {
  name?: string;
  label: string;
  provider: string;
  model: string;
  capabilities?: ModelCapability[];
}

export interface ModelConfigurationUpdate {
  name: string;
  label?: string;
  provider?: string;
  model?: string;
  contextWindowTokens?: number;
  capabilities?: ModelCapability[];
}

export interface ModelDefaultUpdate {
  capability: ModelCapability;
  name: string;
}

export interface ProviderSettingsUpdate {
  provider: string;
  label?: string;
  apiKey?: string;
  apiBase?: string;
  apiType?: "auto" | "chat_completions" | "responses";
}

export interface ProviderSettingsCreate {
  name: string;
  apiKey?: string;
  apiBase: string;
  apiType?: "auto" | "chat_completions" | "responses";
}

export interface WebSearchSettingsUpdate {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  maxResults?: number;
  timeout?: number;
  useJinaReader?: boolean;
}

export interface NetworkSafetySettingsUpdate {
  webuiAllowLocalServiceAccess: boolean;
  webuiDefaultAccessMode: WebuiDefaultAccessMode;
}

export interface ImageGenerationSettingsUpdate {
  enabled: boolean;
  provider: string;
  model: string;
  defaultAspectRatio: string;
  defaultImageSize: string;
  maxImagesPerTurn: number;
}

export interface TranscriptionSettingsUpdate {
  enabled?: boolean;
  provider?: string;
  model?: string;
  language?: string;
  maxDurationSec?: number;
  maxUploadMb?: number;
}

export interface SlashCommand {
  command: string;
  title: string;
  description: string;
  icon: string;
  argHint?: string;
}

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "error";

export type InboundEvent =
  | {
      event: "ready";
      chat_id: string;
      client_id: string;
      agent_ready?: boolean;
      mcp_status?: BootstrapResponse["mcp_status"];
    }
  | {
      event: "runtime_status";
      agent_ready: boolean;
      mcp_status: BootstrapResponse["mcp_status"];
    }
  | {
      event: "browser_frame";
      chat_id: string;
      browser_session_id: string;
      backend: "playwright_mcp" | string;
      url?: string | null;
      title?: string | null;
      image_base64: string;
      mime_type: "image/jpeg" | "image/png";
      captured_at: number;
      action_id?: string;
    }
  | {
      event: "browser_status";
      chat_id: string;
      browser_session_id: string;
      backend: "playwright_mcp" | string;
      status: "starting" | "running" | "user_control" | "stopped" | "error";
      message?: string;
      timestamp: number;
    }
  | {
      event: "browser_action";
      chat_id: string;
      browser_session_id: string;
      action_id: string;
      label: string;
      tool_name: string;
      status: "running" | "completed" | "error";
      timestamp: number;
    }
  | { event: "attached"; chat_id: string }
  | {
      event: "message";
      chat_id: string;
      text: string;
      /** Authoritative completion of a reply already delivered by streaming.
       * Merge its attachments and metadata into the streamed bubble. */
      replace_stream?: boolean;
      reply_to?: string;
      media?: string[];
      media_urls?: Array<{
        id?: string;
        url: string;
        download_url?: string;
        local_path?: string;
        name?: string;
        kind?: UIMediaKind;
        mime_type?: string;
        size?: number;
      }>;
      tool_events?: ToolProgressEvent[];
      /** Present when the frame is an agent breadcrumb (e.g. tool hint,
       * generic progress line) rather than a conversational reply. */
      kind?: "tool_hint" | "progress" | "reasoning";
      /** Server-measured turn wall time when this frame finishes an assistant reply. */
      latency_ms?: number;
      /** Optional structured payload on progress frames (channel-specific). */
      agent_ui?: AgentUIBlob;
      /** Optional structured assistant prompt rendered as an inline card. */
      interactive_prompt?: UIInteractivePrompt;
    }
  | {
      event: "file_edit";
      chat_id: string;
      edits: UIFileEdit[];
    }
  | {
      event: "delta";
      chat_id: string;
      text: string;
      stream_id?: string;
    }
  | {
      event: "stream_end";
      chat_id: string;
      stream_id?: string;
      text?: string;
      /** The completed text segment is public action narration followed by
       * tool execution, not the turn's final conversational answer. */
      resuming?: boolean;
      stream_kind?: "narration" | "answer" | string;
    }
  | {
      event: "reasoning_delta";
      chat_id: string;
      text: string;
      stream_id?: string;
    }
  | {
      event: "reasoning_end";
      chat_id: string;
      stream_id?: string;
    }
  | {
      /** Public action narration shown in the Steps timeline, never in the
       * final assistant answer body. */
      event: "narration_delta";
      chat_id: string;
      text: string;
      stream_id?: string;
      /** Replaces the provisional normal-delta stream with this public
       * narration instead of appending a duplicate row. */
      replaces_stream_id?: string;
    }
  | {
      event: "narration_end";
      chat_id: string;
      stream_id?: string;
      replaces_stream_id?: string;
    }
  | {
      /** Hint that a successful file operation produced a session artifact.
       * The HTTP artifact index remains the source of truth. */
      event: "artifact_created";
      chat_id: string;
      artifact: {
        id?: string;
        project_id?: string;
        session_id?: string;
        status?: "staging" | "ready" | "failed" | "missing" | "quarantined" | string;
        path: string;
        name?: string;
        kind?: string;
        size?: number;
        modified_at?: string | number;
        mime_type?: string;
        preview_url?: string;
        download_url?: string;
      };
    }
  | {
      event: "runtime_model_updated";
      model_name: string;
      model_preset?: string | null;
    }
  | {
      event: "turn_started";
      chat_id: string;
      snapshot_revision: number;
      turn: TurnLifecycleResource;
    }
  | {
      event: "turn_completed";
      chat_id: string;
      snapshot_revision: number;
      turn: TurnLifecycleResource;
    }
  | {
      schema_version?: number;
      event:
        | "turn_plan_created"
        | "turn_plan_updated"
        | "turn_plan_rebased"
        | "turn_plan_terminalized";
      event_id?: string;
      chat_id: string;
      project_id?: string;
      session_id?: string;
      turn_id: string;
      plan: TurnPlanResource;
    }
  | {
      event: "thread_status_changed";
      chat_id: string;
      runtime_epoch?: string | null;
      snapshot_revision: number;
      thread_status: ThreadRuntimeStatus;
      active_turn?: TurnLifecycleResource | null;
      latest_turn?: TurnLifecycleResource | null;
    }
  | {
      event: "turn_end";
      chat_id: string;
      latency_ms?: number;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        cached_tokens?: number;
        cache_read_input_tokens?: number;
        confirmed_new_tokens?: number;
        new_tokens?: number;
      };
      /** Terminal disposition for a completed, failed, or user-cancelled turn. */
      finish_reason?: "cancelled" | "completed" | "error" | string;
      /** Authoritative sustained-goal snapshot for this chat (same shape as ``goal_state`` events). */
      goal_state?: GoalStateWsPayload;
    }
  | {
      event: "goal_status";
      chat_id: string;
      /** Turn executing (user message through agent loop). */
      status: "running" | "idle";
      /** Server ``time.time()`` when ``status`` is ``running``. */
      started_at?: number;
    }
  | {
      event: "goal_state";
      chat_id: string;
      goal_state: GoalStateWsPayload;
    }
  | {
      event: "session_updated";
      chat_id: string;
      session_id?: string;
      project_id?: string;
      scope?: "metadata" | "thread" | string;
      workspace_scope?: WorkspaceScopePayload;
      expert_team?: ExpertTeamBinding | null;
    }
  | {
      event: "team_run_started";
      chat_id: string;
      run_id: string;
      team_id: string;
      team_name: string;
      members: ExpertTeamMember[];
    }
  | {
      event: "team_member_updated";
      chat_id: string;
      run_id: string;
      team_id: string;
      member: ExpertTeamMember & {
        status: "pending" | "running" | "completed" | "failed" | "cancelled";
        task_id?: string;
        activity?: string;
      };
    }
  | {
      event: "team_run_completed";
      chat_id: string;
      run_id: string;
      team_id: string;
      status: "completed" | "completed_with_warnings" | "failed" | "cancelled";
    }
  | {
      event: "turn_usage_updated";
      chat_id: string;
      turn_id?: string;
      estimated: boolean;
      usage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        estimated_tokens?: number;
        cached_tokens?: number;
        cache_read_input_tokens?: number;
        confirmed_new_tokens?: number;
        new_tokens?: number;
      };
    }
  | {
      event: "transcription_result";
      request_id: string;
      text: string;
    }
  | {
      event: "transcription_error";
      request_id?: string;
      detail: string;
      provider?: string;
    }
  | {
      event: "voice_stream_state";
      stream_id: string;
      state: "listening" | "finalizing" | "done";
      mode: "realtime" | "batch";
      provider?: string;
      model?: string;
      outcome?: "cancelled";
    }
  | {
      event: "voice_transcript_partial";
      stream_id: string;
      text: string;
    }
  | {
      event: "voice_transcript_stable";
      stream_id: string;
      text: string;
    }
  | {
      event: "voice_transcript_final";
      stream_id: string;
      text: string;
    }
  | {
      event: "voice_stream_error";
      stream_id?: string;
      detail: string;
      provider?: string;
      recoverable?: boolean;
    }
  | { event: "error"; chat_id?: string; detail?: string; reason?: string };

export interface OutboundMedia {
  data_url: string;
  name?: string;
}

export interface OutboundImageGeneration {
  enabled: true;
  aspect_ratio?: string | null;
}

export interface OutboundCliAppMention {
  name: string;
  display_name?: string;
  category?: string;
  entry_point?: string;
  logo_url?: string | null;
  brand_color?: string | null;
}

export interface OutboundMcpPresetMention {
  name: string;
  display_name?: string;
  category?: string;
  transport?: string;
  status?: string;
  configured?: boolean;
  logo_url?: string | null;
  brand_color?: string | null;
}

export interface OutboundSkillScope {
  project_bound_user_skills?: string[];
  explicit_skills?: string[];
}

export interface WebuiThreadPersistedPayload {
  schemaVersion: number;
  sessionKey?: string;
  session_id?: string;
  project_id?: string;
  savedAt?: string;
  messages: UIMessage[];
  workspace_scope?: WorkspaceScopePayload;
  expert_team?: ExpertTeamBinding;
  page?: {
    before_cursor: string | null;
    has_more_before: boolean;
    loaded_message_count: number;
    user_message_offset: number;
  };
}

export type Outbound =
  | { type: "new_chat"; workspace_scope?: WorkspaceScopePayload; expert_team?: ExpertTeamBinding }
  | { type: "attach"; chat_id: string }
  | { type: "set_workspace_scope"; chat_id: string; workspace_scope: WorkspaceScopePayload }
  | { type: "set_expert_team"; chat_id: string; expert_team: ExpertTeamBinding | null }
  | {
      type: "browser_control";
      chat_id: string;
      action: "pause" | "resume" | "stop" | "capture";
    }
  | {
      type: "transcribe_audio";
      request_id: string;
      data_url: string;
      duration_ms?: number;
    }
  | {
      type: "voice_stream_start";
      stream_id: string;
      sample_rate: 16000;
    }
  | {
      type: "voice_audio_chunk";
      stream_id: string;
      sequence: number;
      audio: string;
      duration_ms: number;
    }
  | {
      type: "voice_stream_stop" | "voice_stream_cancel";
      stream_id: string;
    }
  | {
      type: "message";
      chat_id: string;
      content: string;
      media?: OutboundMedia[];
      image_generation?: OutboundImageGeneration;
      cli_apps?: OutboundCliAppMention[];
      mcp_presets?: OutboundMcpPresetMention[];
      skill_scope?: OutboundSkillScope;
      workspace_scope?: WorkspaceScopePayload;
      interactive_prompt_answer?: UIInteractivePromptAnswer;
      expert_team?: ExpertTeamBinding;
      webui?: true;
    };
