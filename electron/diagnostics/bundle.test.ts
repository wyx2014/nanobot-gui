// @vitest-environment node
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDiagnosticBundle, type BundleInput } from './bundle';
import { BundleRedactor } from './redaction';
import { validateExportRequest } from '../../src/shared/diagnosticBundle';

const directories: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function fixture(): Promise<BundleInput> {
  const dir = await mkdtemp(path.join(os.tmpdir(), '诊断 空格-'));
  directories.push(dir);
  return { incidentId: 'incident-test', userData: dir, tempPath: path.join(dir, 'bundle.tmp'),
    environment: { app_version: 'test' }, gateway: { port: 8900, secret: 'opaque-credential', ready: false },
    request: { export_id: 'export_00000000-0000-4000-8000-000000000000', description: 'PPT 一直转圈',
      occurred_at: new Date().toISOString(), window_minutes: 15, scope: 'application' } };
}

describe('diagnostic bundle', () => {
  it('exports an offline ZIP with verifiable files, useful errors and no legacy payloads', async () => {
    const input = await fixture();
    const timestamp = new Date().toISOString();
    await writeFile(path.join(input.userData, 'desktop-events.jsonl'), [
      JSON.stringify({ timestamp, event_name: 'renderer.uncaught', level: 'error', request_id: 'req-test', details: { body: 'private body', error_code: 'RENDER_FAILED' } }),
      JSON.stringify({ timestamp, event_name: 'renderer.uncaught', status: 'failed', details: {
        incident_id: 'incident-observed', incident_snapshot: { captured_at: timestamp, chat_id: 'chat-failed', messages: ['private body'] },
        stack_frames: [{ module: 'catalog.js', function: 'fetchCatalog', line: 42, column: 7, body: 'private body' }] } }),
      '{malformed',
    ].join('\n'));
    await writeFile(path.join(input.userData, 'startup.log'), `[${timestamp}] [stdout] private model body opaque-credential\n[${timestamp}] [stderr] Error: private response`);
    await writeFile(path.join(input.userData, 'nanobot.2026-09-08_00-00-00_000000.log.gz'), gzipSync(`${timestamp} ERROR TimeoutError: private text`));
    const stages: string[] = [];
    const result = await buildDiagnosticBundle(input, (stage) => stages.push(stage));
    expect(result.status).toBe('partial');
    expect(result.sources.gateway.reason).toBe('GATEWAY_OFFLINE');
    expect(result.sources.desktop.malformed_records).toBe(1);
    expect(stages).toEqual(['collecting', 'redacting', 'packaging']);
    const zip = await JSZip.loadAsync(await readFile(input.tempPath), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    for (const file of manifest.files) {
      const bytes = await zip.file(file.path)!.async('nodebuffer');
      expect(bytes.length).toBe(file.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
    const all = (await Promise.all(Object.values(zip.files).filter((file) => !file.dir).map((file) => file.async('string')))).join('\n');
    expect(all).not.toContain('private body');
    expect(all).not.toContain('private response');
    expect(all).not.toContain('private model body');
    expect(all).not.toContain('opaque-credential');
    expect(all).toContain('RENDER_FAILED');
    expect(all).toContain('TimeoutError');
    expect(all).toContain('PPT 一直转圈');
    const incidents = JSON.parse(await zip.file('snapshots/incidents.json')!.async('string'));
    expect(incidents.incidents[0]).toMatchObject({ incident_id: 'incident-observed', kind: 'failure_time_snapshot',
      snapshot: { chat_id: 'chat-failed' }, evidence: { file: 'events/desktop.jsonl', line: 2 } });
    const desktop = (await zip.file('events/desktop.jsonl')!.async('string')).trim().split('\n').map((line) => JSON.parse(line));
    expect(desktop[1].details.stack_frames[0]).toEqual({ module: 'catalog.js', function: 'fetchCatalog', line: 42, column: 7 });
  });

  it('filters desktop scope and time and excludes unscoped text logs', async () => {
    const input = await fixture();
    input.request.scope = 'session';
    input.request.renderer = { captured_at: new Date().toISOString(), connection_status: 'open', session_id: 'session-one', chat_id: 'chat-one' };
    const event = (session: string | undefined, timestamp: string) => JSON.stringify({ timestamp, event_name: 'http.request', session_id: session });
    await writeFile(path.join(input.userData, 'desktop-events.jsonl'), [event('session-one', new Date().toISOString()),
      event('session-other', new Date().toISOString()), event(undefined, new Date().toISOString()), event('session-one', '2020-01-01T00:00:00Z')].join('\n'));
    const result = await buildDiagnosticBundle(input, () => {});
    expect(result.sources.desktop.count).toBe(1);
    expect(result.sources.startup).toMatchObject({ status: 'excluded', reason: 'NOT_SESSION_SCOPED' });
    expect(result.sources.gateway_text).toMatchObject({ status: 'excluded', reason: 'NOT_SESSION_SCOPED' });
    const zip = await JSZip.loadAsync(await readFile(input.tempPath));
    expect(zip.file('logs/startup.txt')).toBeNull();
    expect(zip.file('logs/gateway.txt')).toBeNull();
  });

  it('rejects symlinks and broken archives when collecting all runtime logs', async () => {
    const input = await fixture();
    await writeFile(path.join(input.userData, 'secret-file'), 'secret');
    await symlink(path.join(input.userData, 'secret-file'), path.join(input.userData, 'startup.log'));
    await writeFile(path.join(input.userData, 'nanobot.2026-09-08_00-00-00_000000.log.gz'), 'broken');
    const result = await buildDiagnosticBundle(input, () => {});
    expect(result.sources.startup.status).toBe('unavailable');
    expect(result.sources.gateway_text.status).toBe('truncated');
  });

  it('keeps only the chosen session across desktop and older gateway sources, including earlier turns', async () => {
    const input = await fixture();
    input.request.scope = 'session';
    input.request.renderer = { captured_at: new Date().toISOString(), connection_status: 'open',
      session_id: 'session-two', chat_id: 'chat-two', trace_id: 'trace-latest' };
    input.gateway.ready = true;
    const event = { timestamp: new Date().toISOString(), event_name: 'http.request' };
    await writeFile(path.join(input.userData, 'desktop-events.jsonl'), [
      { ...event, session_id: 'session-two' }, { ...event, chat_id: 'chat-two' },
      { ...event, trace_id: 'trace-earlier' }, { ...event, session_id: 'session-one' },
      { ...event, chat_id: 'chat-one' }, event,
    ].map((row) => JSON.stringify(row)).join('\n'));
    const sources = Object.fromEntries(['logs', 'security_events', 'traces', 'agent_runs', 'trace_spans'].map((name) => [name, { status: 'included' }]));
    const projection = { schema_version: 1, captured_at: Date.now(), completed_at: Date.now(), sources,
      tables: { logs: [
        { timestamp: Date.now(), session_id: 'session-two', event_name: 'turn.run' },
        { timestamp: Date.now(), trace_id: 'trace-earlier', event_name: 'tool.call' },
        { timestamp: Date.now(), session_id: 'session-one', event_name: 'turn.run' },
        { timestamp: Date.now(), event_name: 'gateway.start' },
      ], security_events: [{ session_id: 'session-two' }, { session_id: 'session-one' }, { session_id: null }],
      traces: [{ id: 'trace-earlier', session_id: 'session-two' }, { id: 'trace-other', session_id: 'session-one' }],
      agent_runs: [{ trace_id: 'trace-earlier' }, { trace_id: 'trace-other' }],
      trace_spans: [{ id: 'span-two', trace_id: 'trace-earlier' }, { id: 'span-one', trace_id: 'trace-other' }] },
      snapshot: { runtime: { status: 'included' } } };
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ token: 'short-lived-secret' })).mockResolvedValueOnce(Response.json(projection));
    vi.stubGlobal('fetch', fetchMock);
    const result = await buildDiagnosticBundle(input, () => {});
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('session_id')).toBe('session-two');
    expect(result.sources.desktop.count).toBe(3);
    expect(result.sources.gateway_logs.count).toBe(2);
    expect(result.sources.gateway_security_events.count).toBe(1);
    expect(result.sources.gateway_traces.count).toBe(1);
    expect(result.sources.gateway_agent_runs.count).toBe(1);
    expect(result.sources.gateway_trace_spans.count).toBe(1);
    const zip = await JSZip.loadAsync(await readFile(input.tempPath));
    const all = (await Promise.all(Object.values(zip.files).filter((file) => !file.dir).map((file) => file.async('string')))).join('\n');
    expect(all).not.toMatch(/session-one|chat-one|trace-other|gateway\.start/);
    expect(all).toContain('trace-earlier');
  });

  it('never fetches application logs for a local chat without a gateway session', async () => {
    const input = await fixture();
    input.gateway.ready = true;
    input.request.scope = 'session';
    input.request.renderer = { captured_at: new Date().toISOString(), connection_status: 'open', chat_id: 'chat-new' };
    input.request = validateExportRequest(input.request);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const event = { timestamp: new Date().toISOString(), event_name: 'renderer.uncaught' };
    await writeFile(path.join(input.userData, 'desktop-events.jsonl'), [
      { ...event, chat_id: 'chat-new' }, { ...event, chat_id: 'chat-other' }, event,
    ].map((row) => JSON.stringify(row)).join('\n'));
    const result = await buildDiagnosticBundle(input, () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.sources.gateway).toMatchObject({ status: 'unavailable', reason: 'SESSION_NOT_SYNCED' });
    expect(result.sources.desktop.count).toBe(1);
    expect(() => validateExportRequest({ ...input.request, renderer: { captured_at: new Date().toISOString() } })).toThrow('INVALID_EXPORT_SESSION');
  });

  it('uses authenticated gateway projection and retains traces longer than 200 spans', async () => {
    const input = await fixture();
    input.gateway.ready = true;
    input.collection = { desktop: { status: 'timeout', target_seq: 10, processed_seq: 7 }, renderer: { status: 'completed' } };
    const sources = Object.fromEntries(['logs', 'security_events', 'traces', 'agent_runs', 'trace_spans'].map((name) => [name, { status: 'included' }]));
    const projection = { schema_version: 1, captured_at: Date.now(), completed_at: Date.now(), sources,
      tables: { logs: [{ timestamp: Date.now(), event_name: 'llm.attempt', trace_id: 'trc-1', details: { input_tokens: 42, api_key: 'opaque-credential' } }],
        security_events: [], traces: [{ id: 'trc-1' }], agent_runs: [],
        trace_spans: Array.from({ length: 250 }, (_, index) => ({ id: `span-${index}`, trace_id: 'trc-1' })) },
      snapshot: { runtime: { status: 'included' }, ready: true,
        doctor: { overall_status: 'warning', checks: [{ id: 'runtime.mcp', status: 'warning' }] } } };
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ token: 'short-lived-secret' })).mockResolvedValueOnce(Response.json(projection));
    vi.stubGlobal('fetch', fetchMock);
    const result = await buildDiagnosticBundle(input, () => {});
    expect(fetchMock.mock.calls[0][1].headers['X-Nanobot-Auth']).toBe(input.gateway.secret);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer short-lived-secret');
    expect(result.sources.gateway_trace_spans.count).toBe(250);
    expect(result.sources.desktop_flush).toMatchObject({ status: 'truncated', reason: 'QUEUE_TIMEOUT', target_seq: 10 });
    expect(result.sources.gateway_flush).toMatchObject({ status: 'unavailable' });
    const zip = await JSZip.loadAsync(await readFile(input.tempPath));
    const events = await zip.file('events/gateway.jsonl')!.async('string');
    expect(events).toContain('"input_tokens":42');
    expect(events).not.toContain('opaque-credential');
    expect(JSON.parse(await zip.file('doctor.json')!.async('string')).overall_status).toBe('warning');
  });

  it('cleans credentials and aliases paths consistently while rejecting arbitrary IPC fields', async () => {
    const redactor = new BundleRedactor(['opaque-credential']);
    const clean = redactor.value({ input_tokens: 123, authorization: 'Basic dXNlcjpwYXNz',
      stack: 'at f (/Users/private/person/a.ts:12)\nat g (/Users/private/person/a.ts:12)',
      route: 'https://user:password@private.example/api?access_token=secret', content: 'private document',
      error_code: 'HTTP_401', server_id: 'private enterprise server' });
    const text = JSON.stringify(clean);
    expect(text).not.toMatch(/private|dXNlcj|access_token|password/);
    expect(text).toContain('HTTP_401');
    expect((clean as { input_tokens: number }).input_tokens).toBe(123);
    const input = await fixture();
    const validated = validateExportRequest({ ...input.request, directory: '/etc', renderer: { captured_at: new Date().toISOString(), connection_status: 'open', messages: ['secret'], session_id: 'id' } });
    expect(JSON.stringify(validated)).not.toMatch(/secret|directory|messages/);
    expect(() => validateExportRequest({ ...input.request, window_minutes: 50000 })).toThrow();
  });
});
