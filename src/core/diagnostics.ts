import { diagnosticError, diagnosticId, sanitizeDiagnostic, type DiagnosticEvent, type DiagnosticInput, type DiagnosticStatus } from '../shared/diagnostics';

const processId = diagnosticId('renderer');
let sequence = 0;
let dropped = 0;
const pending: DiagnosticEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

export function flushDiagnostics(): void {
  clearTimeout(timer);
  timer = undefined;
  if (!pending.length) return;
  const batch = pending.splice(0, 50);
  try { window.ipc?.send('diagnostics:record-batch', { events: batch, dropped }); }
  catch { dropped += batch.length; }
  if (pending.length) timer = setTimeout(flushDiagnostics, 250);
}

export function recordDiagnostic(input: DiagnosticInput): void {
  try {
    if (typeof window === 'undefined' || !window.ipc?.send) return;
    const safe = sanitizeDiagnostic(input);
    if (!safe) return;
    if (pending.length >= 250) { pending.shift(); dropped++; }
    pending.push({ ...safe, schema_version: 1, event_id: diagnosticId('evt'), timestamp: new Date().toISOString(), process_instance_id: processId, process_seq: ++sequence });
    if (!timer) timer = setTimeout(flushDiagnostics, 250);
  } catch { /* Diagnostics cannot interrupt a user action. */ }
}

export function startDiagnostic(event_name: string, context: Omit<DiagnosticInput, 'event_name' | 'status'> = {}) {
  const started = performance.now();
  const client_action_id = context.client_action_id ?? diagnosticId('action');
  const identity = { ...context, client_action_id };
  recordDiagnostic({ ...identity, event_name, status: 'started' });
  let finished = false;
  return {
    client_action_id,
    finish(status: DiagnosticStatus = 'completed', details?: Record<string, unknown>) {
      if (finished) return;
      finished = true;
      recordDiagnostic({ ...identity, event_name, status, level: status === 'failed' ? 'error' : 'info', duration_ms: performance.now() - started, details: { ...context.details, ...details } });
    },
  };
}

export function installDiagnosticCapture(): () => void {
  const error = (event: ErrorEvent) => recordDiagnostic({ event_name: 'renderer.uncaught', status: 'failed', level: 'error', details: diagnosticError(event.error) });
  const rejection = (event: PromiseRejectionEvent) => recordDiagnostic({ event_name: 'renderer.unhandled_rejection', status: 'failed', level: 'error', details: diagnosticError(event.reason) });
  window.addEventListener('error', error);
  window.addEventListener('unhandledrejection', rejection);
  window.addEventListener('pagehide', flushDiagnostics);
  recordDiagnostic({ event_name: 'renderer.started' });
  return () => {
    window.removeEventListener('error', error);
    window.removeEventListener('unhandledrejection', rejection);
    window.removeEventListener('pagehide', flushDiagnostics);
    flushDiagnostics();
  };
}
