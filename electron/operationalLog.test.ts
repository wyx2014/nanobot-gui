// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperationalLog, recordRendererBatch } from './operationalLog';

const directories: string[] = [];
async function directory() { const dir = await mkdtemp(path.join(tmpdir(), 'tpcowork-logs-')); directories.push(dir); return dir; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe('operational log', () => {
  it('reports a blocked writer and acknowledges a fixed boundary despite later traffic', async () => {
    const dir = await directory();
    const log = new OperationalLog(path.join(dir, 'events'));
    const releases: Array<() => void> = [];
    const append = fs.appendFile;
    vi.spyOn(fs, 'appendFile').mockImplementation(async (...args) => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return append(...args);
    });
    try {
      log.record({ event_name: 'main.started' });
      await vi.waitFor(() => expect(releases).toHaveLength(1));
      expect(await log.flush(5)).toMatchObject({ status: 'timeout', target_seq: 1, persisted_seq: 0 });
      const boundary = log.flush();
      log.record({ event_name: 'main.window_load', status: 'completed' });
      releases[0]();
      expect(await boundary).toMatchObject({ status: 'completed', target_seq: 1, processed_seq: 1 });
      await vi.waitFor(() => expect(releases).toHaveLength(2));
      releases[1]();
      expect(await log.flush()).toMatchObject({ status: 'completed', target_seq: 2, persisted_seq: 2 });
    } finally { releases.forEach((release) => release()); await log.close(); }
  });

  it('persists a bounded crash snapshot with explicitly dated cached renderer context', async () => {
    const dir = await directory();
    const log = new OperationalLog(path.join(dir, 'events'));
    log.setSnapshotProvider(() => ({ captured_at: '2026-09-08T00:00:00Z', context_captured_at: '2026-09-08T00:00:00Z',
      chat_id: 'chat-one', gateway_ready: false, messages: ['private message'] }));
    log.record({ event_name: 'main.renderer_unresponsive', level: 'warning' });
    await log.close();
    const row = JSON.parse((await readFile(log.filePath, 'utf8')).trim());
    expect(row.details.incident_snapshot).toMatchObject({ chat_id: 'chat-one', gateway_ready: false,
      context_captured_at: '2026-09-08T00:00:00Z' });
    expect(row.details.incident_snapshot.captured_at).not.toBe('2026-09-08T00:00:00Z');
    expect(JSON.stringify(row)).not.toContain('private message');
  });
  it('persists sanitized events in order and rotates within a bounded archive count', async () => {
    const dir = await directory();
    const file = path.join(dir, 'desktop-events.jsonl');
    const log = new OperationalLog(file, 600);
    for (let index = 0; index < 15; index++) {
      log.record({ event_name: 'http.request', details: { attempt: index, password: 'private', body: 'private', error_code: 'FAIL' } });
      await log.flush();
    }
    await log.close();
    const entries = await readdir(dir);
    expect(entries.length).toBeLessThanOrEqual(11);
    const all = await Promise.all(entries.map((name) => readFile(path.join(dir, name), 'utf8')));
    expect(all.join('')).not.toContain('private');
    const latest = JSON.parse((await readFile(file, 'utf8')).trim().split('\n').at(-1)!);
    expect(latest.process_seq).toBe(15);
    expect(latest.app_launch_id).toMatch(/^launch_/);
  });

  it('bounds queued records and reports disk failures without rejecting user actions', async () => {
    const dir = await directory();
    const blocker = path.join(dir, 'file');
    await writeFile(blocker, 'not a directory');
    const log = new OperationalLog(path.join(blocker, 'events'), 5000, 2);
    for (let index = 0; index < 20; index++) log.record({ event_name: 'main.started' });
    await log.close();
    expect(log.writeFailures).toBeGreaterThan(0);
    expect(log.dropped).toBe(20);
    expect(await log.flush()).toMatchObject({ status: 'write_failed' });
  });

  it('rejects malformed renderer identities and prevents forging the launch identity', async () => {
    const dir = await directory();
    const file = path.join(dir, 'events');
    const log = new OperationalLog(file);
    recordRendererBatch(log, { events: [{ event_name: 'renderer.started', process_instance_id: 'main-forged' }] });
    const id = '00000000-0000-4000-8000-000000000000';
    recordRendererBatch(log, { events: [{ event_name: 'renderer.started', app_launch_id: 'forged', process_instance_id: `renderer_${id}`, event_id: `evt_${id}`, process_seq: 1, timestamp: new Date().toISOString(), details: { content: 'private' } }] });
    await log.close();
    const text = await readFile(file, 'utf8');
    expect(text.trim().split('\n')).toHaveLength(1);
    expect(text).not.toContain('forged');
    expect(text).not.toContain('private');
  });
});
