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
}
export interface DiagnosticExportRequest {
  export_id: string;
  description: string;
  occurred_at: string;
  window_minutes: 15 | 60 | 1440;
  scope: 'application' | 'session';
  renderer?: RendererDiagnosticSnapshot;
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
    'runtime_epoch', 'conversation_status', 'turn_status', 'last_step_status', 'last_step_type']) {
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
  if (raw.scope === 'session' && !renderer?.session_id) throw new Error('INVALID_EXPORT_SESSION');
  return { export_id: raw.export_id, description: raw.description, occurred_at: raw.occurred_at,
    window_minutes: raw.window_minutes, scope: raw.scope, renderer };
}
