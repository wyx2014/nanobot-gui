export type ExportStage = 'collecting' | 'redacting' | 'packaging';
export interface RendererDiagnosticSnapshot {
  captured_at: string;
  connection_status: string;
  chat_id?: string;
  session_id?: string;
  project_id?: string;
  trace_id?: string;
  turn_id?: string;
  runtime_epoch?: string;
  snapshot_revision?: number;
  conversation_status?: string;
  turn_status?: string;
  turn_started_at?: number;
  step_count?: number;
  last_step_status?: string;
  last_step_type?: string;
  last_progress_at?: number;
  context_kind?: string;
}
export interface DiagnosticExportRequest {
  export_id: string;
  description: string;
  occurred_at: string;
  window_minutes: 15 | 60 | 1440;
  scope: 'application' | 'session';
  renderer?: RendererDiagnosticSnapshot;
  renderer_flush?: DiagnosticFlushResult;
}
export interface DiagnosticFlushResult {
  status: 'completed' | 'timeout' | 'write_failed' | 'incomplete' | 'unavailable';
  target_seq?: number;
  processed_seq?: number;
  persisted_seq?: number;
  dropped?: number;
  write_failures?: number;
  queue_depth?: number;
  renderer_target_seq?: number;
  renderer_received_seq?: number;
}
export function validateFlushResult(value: unknown): DiagnosticFlushResult {
  const raw = value as Record<string, unknown> | undefined;
  if (!raw || !['completed', 'timeout', 'write_failed', 'incomplete', 'unavailable'].includes(String(raw.status))) return { status: 'unavailable' };
  const output: DiagnosticFlushResult = { status: raw.status as DiagnosticFlushResult['status'] };
  for (const key of ['target_seq', 'processed_seq', 'persisted_seq', 'dropped', 'write_failures', 'queue_depth', 'renderer_target_seq', 'renderer_received_seq'] as const) {
    if (Number.isSafeInteger(raw[key]) && Number(raw[key]) >= 0) output[key] = Number(raw[key]);
  }
  return output;
}
export interface DiagnosticSource {
  status: 'included' | 'unavailable' | 'truncated' | 'excluded';
  count?: number;
  reason?: string;
  [key: string]: unknown;
}
export interface DiagnosticExportResult {
  status: 'ready' | 'partial' | 'cancelled' | 'failed';
  incident_id?: string;
  path?: string;
  bytes?: number;
  sources?: Record<string, DiagnosticSource>;
  error_code?: string;
}

export const EXPORT_ID_PATTERN = /^export_[a-f0-9-]{36}$/;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;

/** An IPC snapshot is a projection, never a serialized store. */
export function validateRendererSnapshot(value: unknown): RendererDiagnosticSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.captured_at !== 'string' || raw.captured_at.length > 30 || !Number.isFinite(Date.parse(raw.captured_at))) return undefined;
  const output: Record<string, string | number> = { captured_at: raw.captured_at };
  for (const key of ['connection_status', 'chat_id', 'session_id', 'project_id', 'trace_id', 'turn_id',
    'runtime_epoch', 'conversation_status', 'turn_status', 'last_step_status', 'last_step_type', 'context_kind']) {
    const item = raw[key];
    if (typeof item === 'string' && ID_PATTERN.test(item)) output[key] = item;
  }
  for (const key of ['snapshot_revision', 'turn_started_at', 'step_count', 'last_progress_at']) {
    const item = raw[key];
    if (typeof item === 'number' && Number.isFinite(item) && item >= 0) output[key] = item;
  }
  output.connection_status ??= 'unknown';
  return output as unknown as RendererDiagnosticSnapshot;
}

export function validateExportRequest(value: unknown): DiagnosticExportRequest {
  if (!value || typeof value !== 'object') throw new Error('INVALID_EXPORT_REQUEST');
  const raw = value as DiagnosticExportRequest;
  if (!EXPORT_ID_PATTERN.test(raw.export_id) || typeof raw.description !== 'string' || raw.description.length > 4000
    || ![15, 60, 1440].includes(raw.window_minutes) || !['application', 'session'].includes(raw.scope)
    || typeof raw.occurred_at !== 'string' || raw.occurred_at.length > 30
    || !Number.isFinite(Date.parse(raw.occurred_at)) || Date.parse(raw.occurred_at) > Date.now() + 60_000
    || Date.parse(raw.occurred_at) < 0) throw new Error('INVALID_EXPORT_REQUEST');
  const renderer = validateRendererSnapshot(raw.renderer);
  if (raw.scope === 'session' && !renderer?.session_id && !renderer?.chat_id) throw new Error('INVALID_EXPORT_SESSION');
  return { export_id: raw.export_id, description: raw.description, occurred_at: raw.occurred_at,
    window_minutes: raw.window_minutes, scope: raw.scope, renderer,
    renderer_flush: raw.renderer_flush ? validateFlushResult(raw.renderer_flush) : undefined };
}
