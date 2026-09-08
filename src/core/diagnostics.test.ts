import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagnosticError, diagnosticRoute, sanitizeDiagnostic } from '../shared/diagnostics';
import { flushDiagnostics, installDiagnosticCapture, recordDiagnostic, startDiagnostic } from './diagnostics';
import { fetchGatewayResponse, fetchSettings, registerTokenProvider } from './api';

beforeEach(() => { flushDiagnostics(); vi.mocked(window.ipc.send).mockClear(); vi.useFakeTimers(); });
afterEach(() => { flushDiagnostics(); vi.useRealTimers(); registerTokenProvider(null); vi.unstubAllGlobals(); });

describe('renderer diagnostics', () => {
  it.each([
    ['text/html', '<!doctype html>private response body', 'NON_JSON_RESPONSE'],
    ['application/json', '{"private response body":', 'JSON_READ_FAILED'],
  ])('correlates invalid %s responses without logging their bodies', async (contentType, body, errorCode) => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(body, {
      status: 200,
      headers: { 'content-type': contentType, 'X-Request-Id': new Headers(init.headers).get('X-Request-Id')! },
    })));
    await expect(fetchSettings('private token', 'http://127.0.0.1:8900')).rejects.toThrow();
    flushDiagnostics();
    const events = vi.mocked(window.ipc.send).mock.calls.flatMap((call) => (
      call[1] as { events: Array<{ event_name: string; request_id: string; details: Record<string, unknown> }> }
    ).events);
    const request = events.find((event) => event.event_name === 'http.request');
    const failure = events.find((event) => event.event_name === 'http.invalid_response');
    expect(request?.request_id).toBeTruthy();
    expect(failure?.request_id).toBe(request?.request_id);
    expect(failure?.details.error_code).toBe(errorCode);
    expect(JSON.stringify(events)).not.toContain('private');
  });

  it('correlates both sides of HTTP retries without classifying a retry transport error as auth failure', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockRejectedValueOnce(new TypeError('connection lost with private body'));
    vi.stubGlobal('fetch', fetchMock);
    registerTokenProvider(async () => 'private refreshed token');
    const result = await fetchGatewayResponse('http://127.0.0.1:8900/api/settings', 'private token');
    expect(result.status).toBe(401);
    const first = fetchMock.mock.calls[0][1].headers;
    const second = fetchMock.mock.calls[1][1].headers;
    expect(first['X-Client-Action-Id']).toBe(second['X-Client-Action-Id']);
    expect(first['X-Request-Id']).not.toBe(second['X-Request-Id']);
    flushDiagnostics();
    const batches = vi.mocked(window.ipc.send).mock.calls.map((call) => call[1] as { events: Array<{ event_name: string; status: string }> });
    expect(batches.flatMap((batch) => batch.events).filter((event) => event.event_name === 'http.auth_refresh').map((event) => event.status)).toEqual(['started', 'completed']);
    expect(JSON.stringify(batches)).not.toContain('private');
  });
  it('records paired operations without request bodies or credentials', () => {
    const operation = startDiagnostic('http.request', { request_id: 'request-1', details: { body: 'private document', api_key: 'sk-secret', route: '/api/settings' } });
    operation.finish('failed', diagnosticError(new Error('response contains private document')));
    operation.finish();
    flushDiagnostics();
    const batch = vi.mocked(window.ipc.send).mock.calls.at(-1)![1] as { events: Array<Record<string, unknown>> };
    expect(batch.events).toHaveLength(2);
    expect(batch.events.map((event) => event.status)).toEqual(['started', 'failed']);
    expect(batch.events[0].client_action_id).toBe(batch.events[1].client_action_id);
    expect(JSON.stringify(batch)).not.toContain('private document');
    expect(JSON.stringify(batch)).not.toContain('sk-secret');
  });

  it('caps batches and pending records during a log flood', () => {
    for (let index = 0; index < 1000; index++) recordDiagnostic({ event_name: 'renderer.started' });
    flushDiagnostics();
    const batch = vi.mocked(window.ipc.send).mock.calls.at(-1)![1] as { events: unknown[]; dropped: number };
    expect(batch.events).toHaveLength(50);
    expect(batch.dropped).toBeGreaterThanOrEqual(750);
    vi.runAllTimers();
    expect(vi.mocked(window.ipc.send).mock.calls).toHaveLength(5);
  });

  it('captures unexpected errors and can uninstall without duplicate listeners', () => {
    const stop = installDiagnosticCapture();
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('sensitive response') }));
    stop();
    const count = vi.mocked(window.ipc.send).mock.calls.length;
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('again') }));
    vi.runAllTimers();
    expect(vi.mocked(window.ipc.send).mock.calls).toHaveLength(count);
    expect(JSON.stringify(vi.mocked(window.ipc.send).mock.calls)).toContain('renderer.uncaught');
    expect(JSON.stringify(vi.mocked(window.ipc.send).mock.calls)).not.toContain('sensitive response');
  });

  it('removes URL credentials, queries and home names from stack metadata', () => {
    expect(diagnosticRoute('http://user:secret@localhost/api/sessions/private-name/thread?token=secret')).toBe('/api/sessions/:id/thread');
    const safe = sanitizeDiagnostic({ event_name: 'renderer.uncaught', details: { stack: 'at f (https://host/app.js?api_key=private:1)\nat g (/Users/private-user/project/app.js:2)' } });
    expect(JSON.stringify(safe)).not.toContain('private');
  });
});
