import fs from 'node:fs/promises';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sanitizeDiagnostic, type DiagnosticEvent, type DiagnosticInput } from '../src/shared/diagnostics';

export const appLaunchId = `launch_${randomUUID()}`;
const processId = `main_${randomUUID()}`;

/** Bounded single writer. All filesystem operations stay off the main event loop. */
export class OperationalLog {
  private queue: string[] = [];
  private writing: Promise<void> | undefined;
  private sequence = 0;
  private closed = false;
  dropped = 0;
  writeFailures = 0;

  constructor(readonly filePath: string, private maxBytes = 5 * 1024 * 1024, private maxQueue = 1000) {}

  record(input: DiagnosticInput, origin?: Pick<DiagnosticEvent, 'timestamp' | 'process_instance_id' | 'process_seq' | 'event_id'>): void {
    try {
      const safe = sanitizeDiagnostic(input);
      if (!safe || this.closed) return;
      const critical = safe.level === 'error' || (safe.status && safe.status !== 'started');
      const capacity = critical ? this.maxQueue : this.maxQueue - Math.min(32, Math.floor(this.maxQueue / 4));
      if (this.queue.length >= capacity) { this.dropped++; return; }
      const event: DiagnosticEvent = { ...safe, schema_version: 1, event_id: `evt_${randomUUID()}`, timestamp: new Date().toISOString(), process_instance_id: processId, process_seq: ++this.sequence, ...origin, app_launch_id: appLaunchId };
      this.queue.push(JSON.stringify(event) + '\n');
      this.writing ??= this.drain().finally(() => { this.writing = undefined; });
    } catch { this.dropped++; }
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const batch = this.queue.splice(0, 50);
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const size = await fs.stat(this.filePath).then((stat) => stat.size).catch(() => 0);
        if (size + Buffer.byteLength(batch.join('')) > this.maxBytes) {
          await fs.rm(`${this.filePath}.10`, { force: true });
          for (let index = 9; index >= 1; index--) {
            await fs.rename(`${this.filePath}.${index}`, `${this.filePath}.${index + 1}`).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
          }
          await fs.rename(this.filePath, `${this.filePath}.1`).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
        }
        await fs.appendFile(this.filePath, batch.join(''), { encoding: 'utf8', mode: 0o600 });
      } catch { this.writeFailures++; this.dropped += batch.length; }
    }
  }

  async flush(): Promise<void> { await this.writing; }
  async close(): Promise<void> { this.closed = true; await this.flush(); }

  recordFatal(input: DiagnosticInput): void {
    // A fatal exception can exit before async writes finish. Persist one bounded record only.
    try {
      const safe = sanitizeDiagnostic(input);
      if (!safe) return;
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
  return { dropped: operationalLog?.dropped ?? 0, write_failures: operationalLog?.writeFailures ?? 0 };
}

export function recordRendererBatch(log: OperationalLog, payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;
  const events = (payload as { events?: unknown }).events;
  if (!Array.isArray(events) || events.length > 50) return;
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    if (typeof event.event_name !== 'string' || !/^(renderer|http|websocket|presentation)\./.test(event.event_name)) continue;
    if (typeof event.process_instance_id !== 'string' || !/^renderer_[a-f0-9-]{36}$/.test(event.process_instance_id)) continue;
    if (typeof event.event_id !== 'string' || !/^evt_[a-f0-9-]{36}$/.test(event.event_id)) continue;
    if (!Number.isSafeInteger(event.process_seq) || event.process_seq < 1) continue;
    if (typeof event.timestamp !== 'string' || event.timestamp.length > 30 || !Number.isFinite(Date.parse(event.timestamp))) continue;
    const safe = sanitizeDiagnostic(event);
    if (!safe) continue;
    const dropped = (payload as { dropped?: unknown }).dropped;
    if (typeof dropped === 'number' && Number.isSafeInteger(dropped) && dropped >= 0) {
      safe.details = { ...safe.details, dropped };
    }
    log.record(safe, { timestamp: event.timestamp, process_instance_id: event.process_instance_id, process_seq: event.process_seq, event_id: event.event_id });
  }
}
