export type DiagnosticStatus = 'started' | 'completed' | 'failed' | 'cancelled' | 'abandoned';
export interface DiagnosticInput {
  event_name: string;
  status?: DiagnosticStatus;
  level?: 'info' | 'warning' | 'error';
  request_id?: string;
  client_action_id?: string;
  trace_id?: string;
  turn_id?: string;
  session_id?: string;
  chat_id?: string;
  duration_ms?: number;
  details?: Record<string, unknown>;
}
export interface DiagnosticEvent extends DiagnosticInput {
  schema_version: 1;
  event_id: string;
  timestamp: string;
  process_instance_id: string;
  process_seq: number;
  app_launch_id?: string;
}

const DETAIL_KEYS = new Set([
  'stage', 'method', 'route', 'status_code', 'attempt', 'timeout_ms', 'delay_ms',
  'previous_status', 'connection_status', 'close_code', 'intentional', 'queue_depth',
  'event_seq', 'revision', 'snapshot_revision', 'runtime_epoch', 'event_type',
  'error_type', 'error_code', 'stack', 'component_stack', 'channel', 'code', 'signal',
  'pid', 'platform', 'arch', 'app_version', 'packaged', 'ready', 'changed', 'restarted',
  'template_id', 'document_id', 'count', 'bytes', 'cache_hit', 'dropped', 'write_failures',
]);

export function diagnosticId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED]')
    .replace(/\b(?:https?|wss?):\/\/[^\s)"'<>]+/gi, (raw) => {
      try { const url = new URL(raw); return `${url.protocol}//<host>${url.pathname}`; } catch { return '<url>'; }
    })
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|cookie)\s*["']?\s*[:=]\s*)[^\r\n,;]+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk[-_]|gh[pousr]_|github_pat_)[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*){0,2}/g, '[REDACTED]')
    .replace(/(?:[A-Za-z]:\\Users\\[^\\\s]+|\/(?:Users|home)\/[^/\s]+)/g, '<home>')
    .slice(0, 4000);
}

export function diagnosticError(cause: unknown): Record<string, unknown> {
  if (!(cause instanceof Error)) return { error_type: typeof cause };
  // Exception messages can contain response bodies. Keep frames, never local variables or messages.
  const frames = cause.stack?.split('\n').filter((line) => /^\s*at\s/.test(line)).slice(0, 12).join('\n');
  const code = (cause as Error & { code?: unknown }).code;
  return { error_type: cause.name, ...(typeof code === 'string' ? { error_code: code } : {}), ...(frames ? { stack: frames } : {}) };
}

export function diagnosticRoute(raw: string): string {
  try {
    const segments = new URL(raw, 'http://gateway').pathname.split('/');
    const resources = new Set(['sessions', 'projects', 'traces', 'artifacts', 'providers', 'skills', 'runs', 'jobs']);
    return segments.map((segment, index) => resources.has(segments[index - 1]) ? ':id' : segment).join('/');
  } catch { return '<invalid-route>'; }
}

export function sanitizeDiagnostic(input: DiagnosticInput): DiagnosticInput | null {
  if (!input || !/^(?:main|bridge|renderer|http|websocket|ipc|presentation|storage)\.[a-z0-9_.]{1,100}$/.test(input.event_name)) return null;
  const output: DiagnosticInput = { event_name: input.event_name };
  if (['started', 'completed', 'failed', 'cancelled', 'abandoned'].includes(input.status ?? '')) output.status = input.status;
  if (['info', 'warning', 'error'].includes(input.level ?? '')) output.level = input.level;
  for (const key of ['request_id', 'client_action_id', 'trace_id', 'turn_id', 'session_id', 'chat_id'] as const) {
    if (typeof input[key] === 'string' && input[key]!.length <= 160) output[key] = redactDiagnosticText(input[key]!);
  }
  if (Number.isFinite(input.duration_ms)) output.duration_ms = Math.max(0, Math.round(input.duration_ms!));
  const details: Record<string, unknown> = {};
  let remaining = 8000;
  if (input.details && typeof input.details === 'object') {
    for (const [key, value] of Object.entries(input.details).slice(0, 48)) {
      if (!DETAIL_KEYS.has(key)) continue;
      if (typeof value === 'string') {
        if (remaining <= 0) break;
        const text = key === 'error_code' && !/^[A-Za-z0-9_.:-]{1,160}$/.test(value)
          ? 'UNCLASSIFIED_ERROR' : redactDiagnosticText(value).slice(0, remaining);
        details[key] = text;
        remaining -= text.length;
      }
      else if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) details[key] = value;
    }
  }
  output.details = details;
  return output;
}
