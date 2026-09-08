import fs from 'node:fs/promises';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDiagnosticIncident, sanitizeDiagnostic, sanitizeIncidentSnapshot, type DiagnosticEvent, type DiagnosticInput } from '../src/shared/diagnostics';
import type { DiagnosticFlushResult } from '../src/shared/diagnosticBundle';

export const appLaunchId = `launch_${randomUUID()}`;
const processId = `main_${randomUUID()}`;

/** Bounded single writer. All filesystem operations stay off the main event loop. */
export class OperationalLog {
  private queue: Array<{ line: string; seq: number }> = [];
  private writing: Promise<void> | undefined;
  private sequence = 0;
  private closed = false;
  private accepted = 0;
  private processed = 0;
  private persisted = 0;
  private waiters = new Set<() => void>();
  private rendererSequences = new Map<string, number>();
  private recent: string[] = [];
  private snapshotProvider?: () => Record<string, unknown>;
  lastRendererSnapshot: Record<string, unknown> = {};
  dropped = 0;
  writeFailures = 0;

  constructor(readonly filePath: string, private maxBytes = 5 * 1024 * 1024, private maxQueue = 1000) {}

  setSnapshotProvider(provider: () => Record<string, unknown>) { this.snapshotProvider = provider; }
  rendererSequence(process: string) { return this.rendererSequences.get(process) ?? 0; }
  health() { return { dropped: this.dropped, write_failures: this.writeFailures, queue_depth: this.accepted - this.processed,
    target_seq: this.accepted, processed_seq: this.processed, persisted_seq: this.persisted }; }

  record(input: DiagnosticInput, origin?: Pick<DiagnosticEvent, 'timestamp' | 'process_instance_id' | 'process_seq' | 'event_id'>): void {
    try {
      const safe = sanitizeDiagnostic(input);
      if (!safe || this.closed) return;
      if (!origin && isDiagnosticIncident(safe)) {
        let context = {};
        try { context = this.snapshotProvider?.() ?? {}; } catch { /* Snapshot collection is best effort. */ }
        safe.details = { ...safe.details, incident_id: `incident_${randomUUID()}`,
          incident_snapshot: sanitizeIncidentSnapshot({ ...context, captured_at: new Date().toISOString(),
            ...this.health(), rss_bytes: process.memoryUsage().rss }), recent_event_ids: this.recent.slice(-32) };
      }
      const critical = safe.level === 'error' || (safe.status && safe.status !== 'started');
      const capacity = critical ? this.maxQueue : this.maxQueue - Math.min(32, Math.floor(this.maxQueue / 4));
      if (this.queue.length >= capacity) { this.dropped++; return; }
      const event: DiagnosticEvent = { ...safe, schema_version: 1, event_id: `evt_${randomUUID()}`, timestamp: new Date().toISOString(), process_instance_id: processId, process_seq: ++this.sequence, ...origin, app_launch_id: appLaunchId };
      this.queue.push({ line: JSON.stringify(event) + '\n', seq: ++this.accepted });
      if (origin) {
        this.rendererSequences.set(origin.process_instance_id, Math.max(this.rendererSequence(origin.process_instance_id), origin.process_seq));
        if (this.rendererSequences.size > 8) this.rendererSequences.delete(this.rendererSequences.keys().next().value!);
      } else {
        this.recent.push(event.event_id);
        if (this.recent.length > 32) this.recent.shift();
      }
      this.writing ??= this.drain().finally(() => { this.writing = undefined; });
    } catch { this.dropped++; }
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const batch = this.queue.splice(0, 50);
      const body = batch.map((entry) => entry.line).join('');
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const size = await fs.stat(this.filePath).then((stat) => stat.size).catch(() => 0);
        if (size + Buffer.byteLength(body) > this.maxBytes) {
          await fs.rm(`${this.filePath}.10`, { force: true });
          for (let index = 9; index >= 1; index--) {
            await fs.rename(`${this.filePath}.${index}`, `${this.filePath}.${index + 1}`).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
          }
          await fs.rename(this.filePath, `${this.filePath}.1`).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
        }
        await fs.appendFile(this.filePath, body, { encoding: 'utf8', mode: 0o600 });
        this.persisted = batch.at(-1)!.seq;
      } catch { this.writeFailures++; this.dropped += batch.length; }
      finally {
        this.processed = batch.at(-1)!.seq;
        for (const notify of this.waiters) notify();
      }
    }
  }

  async flush(timeoutMs = 1000): Promise<DiagnosticFlushResult> {
    // Freeze an accepted-record boundary; later traffic must not extend this wait.
    const target = this.accepted;
    if (this.processed < target) await new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); this.waiters.delete(check); resolve(); };
      const check = () => { if (this.processed >= target) finish(); };
      const timer = setTimeout(finish, timeoutMs);
      this.waiters.add(check);
      check();
    });
    return { ...this.health(), target_seq: target, status: this.processed < target ? 'timeout'
      : this.writeFailures ? 'write_failed' : this.dropped ? 'incomplete' : 'completed' };
  }
  async close(): Promise<void> { this.closed = true; await this.flush(); }

  recordFatal(input: DiagnosticInput): void {
    // A fatal exception can exit before async writes finish. Persist one bounded record only.
    try {
      const safe = sanitizeDiagnostic(input);
      if (!safe) return;
      safe.details = { ...safe.details, incident_id: `incident_${randomUUID()}`,
        incident_snapshot: { captured_at: new Date().toISOString(), connection_status: 'unknown', ...this.health() },
        recent_event_ids: this.recent.slice(-32) };
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, JSON.stringify({ ...safe, schema_version: 1, timestamp: new Date().toISOString(),
        event_id: `evt_${randomUUID()}`, process_instance_id: processId, process_seq: ++this.sequence,
        app_launch_id: appLaunchId }) + '\n', { encoding: 'utf8', mode: 0o600 });
    } catch { this.writeFailures++; }
  }
}

let operationalLog: OperationalLog | undefined;
export function initializeOperationalLog(userData: string): OperationalLog {
  operationalLog ??= new OperationalLog(path.join(userData, 'desktop-events.jsonl'));
  return operationalLog;
}
export function recordMainDiagnostic(input: DiagnosticInput): void { operationalLog?.record(input); }
export function operationalLogHealth() {
  return operationalLog?.health() ?? { dropped: 0, write_failures: 0, queue_depth: 0 };
}

export function recordRendererBatch(log: OperationalLog, payload: unknown): void {
  if (!payload || typeof payload !== 'object') { log.dropped++; return; }
  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events) || events.length > 50) { log.dropped++; return; }
  for (const event of events) {
    if (!event || typeof event !== 'object'
      || typeof event.event_name !== 'string' || !/^(renderer|http|websocket|presentation)\./.test(event.event_name)
      || typeof event.process_instance_id !== 'string' || !/^renderer_[a-f0-9-]{36}$/.test(event.process_instance_id)
      || typeof event.event_id !== 'string' || !/^evt_[a-f0-9-]{36}$/.test(event.event_id)
      || !Number.isSafeInteger(event.process_seq) || event.process_seq < 1
      || typeof event.timestamp !== 'string' || event.timestamp.length > 30 || !Number.isFinite(Date.parse(event.timestamp))) {
      log.dropped++; continue;
    }
    const safe = sanitizeDiagnostic(event);
    if (!safe) { log.dropped++; continue; }
    const snapshot = sanitizeIncidentSnapshot(safe.details?.context_snapshot);
    if (snapshot) log.lastRendererSnapshot = { ...snapshot, context_captured_at: snapshot.captured_at };
    const dropped = (payload as { dropped?: unknown }).dropped;
    if (typeof dropped === 'number' && Number.isSafeInteger(dropped) && dropped >= 0) {
      safe.details = { ...safe.details, dropped };
    }
    log.record(safe, { timestamp: event.timestamp, process_instance_id: event.process_instance_id, process_seq: event.process_seq, event_id: event.event_id });
  }
}
