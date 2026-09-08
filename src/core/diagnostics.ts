import { diagnosticError, diagnosticId, isDiagnosticIncident, sanitizeDiagnostic, type DiagnosticEvent, type DiagnosticInput, type DiagnosticStatus } from '../shared/diagnostics';
import { validateFlushResult, type DiagnosticFlushResult } from '../shared/diagnosticBundle';

const processId = diagnosticId('renderer');
let sequence = 0;
let dropped = 0;
const pending: DiagnosticEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let snapshotProvider: ((event: DiagnosticInput) => Record<string, unknown>) | undefined;
const recent: DiagnosticEvent[] = [];

export function setDiagnosticSnapshotProvider(provider: typeof snapshotProvider) { snapshotProvider = provider; }

export function flushDiagnostics(): void {
  clearTimeout(timer);
  timer = undefined;
  while (pending.length) {
    const batch = pending.splice(0, 50);
    try { window.ipc?.send('diagnostics:record-batch', { events: batch, dropped }); }
    catch { dropped += batch.length; }
  }
}

export async function flushDiagnosticsForExport(): Promise<DiagnosticFlushResult> {
  flushDiagnostics();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return validateFlushResult(await Promise.race([
      window.ipc.invoke('diagnostics:flush', { process_instance_id: processId, process_seq: sequence, dropped }),
      new Promise((resolve) => { timeout = setTimeout(() => resolve({ status: 'timeout' }), 1500); }),
    ]));
  } catch { return { status: 'unavailable' }; }
  finally { clearTimeout(timeout); }
}

export function recordDiagnostic(input: DiagnosticInput): void {
  try {
    if (typeof window === 'undefined' || !window.ipc?.send) return;
    let augmented = input;
    if (isDiagnosticIncident(input)) {
      let snapshot = {};
      try { snapshot = snapshotProvider?.(input) ?? {}; } catch { /* Failure capture cannot fail the action. */ }
      augmented = { ...input, details: { ...input.details, incident_id: diagnosticId('incident'),
        incident_snapshot: { ...snapshot, captured_at: new Date().toISOString(), dropped, queue_depth: pending.length },
        recent_event_ids: recent.filter((event) => (!input.session_id || event.session_id === input.session_id)
          && (!input.chat_id || event.chat_id === input.chat_id)).slice(-32).map((event) => event.event_id) } };
    }
    const safe = sanitizeDiagnostic(augmented);
    if (!safe) return;
    if (pending.length >= 250) { pending.shift(); dropped++; }
    const event: DiagnosticEvent = { ...safe, schema_version: 1, event_id: diagnosticId('evt'), timestamp: new Date().toISOString(), process_instance_id: processId, process_seq: ++sequence };
    pending.push(event);
    recent.push(event);
    if (recent.length > 64) recent.shift();
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
