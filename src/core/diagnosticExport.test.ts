import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelDiagnosticExport, captureRendererDiagnostics, exportDiagnostics } from './diagnosticExport';
import { flushDiagnosticsForExport } from './diagnostics';
import type { DiagnosticExportRequest, DiagnosticFlushResult } from '@/shared/diagnosticBundle';
import { useChatStore } from '@/stores/chatStore';

vi.mock('./diagnostics', () => ({ flushDiagnosticsForExport: vi.fn(), recordDiagnostic: vi.fn(), setDiagnosticSnapshotProvider: vi.fn() }));
const request: DiagnosticExportRequest = { export_id: 'export_00000000-0000-4000-8000-000000000000',
  description: '', occurred_at: '2026-09-08T00:00:00Z', window_minutes: 15, scope: 'application' };
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

describe('diagnostic export preparation', () => {
  it('captures the selected historical conversation without borrowing the active chat state', () => {
    const state = useChatStore.getState();
    vi.spyOn(useChatStore, 'getState').mockReturnValue({ ...state, activeConversationId: 'active', conversations: {
      old: { id: 'old', sessionId: 'session-old', status: 'completed', runtimeSnapshot: {
        latest_turn: { id: 'turn-old', trace_id: 'trace-old', status: 'completed' },
      } }, active: { id: 'active', sessionId: 'session-active', runtimeSnapshot: {
        active_turn: { id: 'turn-active', status: 'running' },
      } },
    } } as unknown as typeof state);
    expect(captureRendererDiagnostics({ event_name: 'diagnostics.export', chat_id: 'old' })).toMatchObject({
      chat_id: 'old', session_id: 'session-old', trace_id: 'trace-old', turn_id: 'turn-old', turn_status: 'completed',
    });
    expect(captureRendererDiagnostics({ event_name: 'diagnostics.export', chat_id: 'deleted' }).chat_id).toBeUndefined();
  });
  it('captures the failing turn rather than a newer active turn or another selected conversation', () => {
    const state = useChatStore.getState();
    vi.spyOn(useChatStore, 'getState').mockReturnValue({ ...state, activeConversationId: 'other', conversations: {
      one: { id: 'one', sessionId: 'session-one', runtimeSnapshot: {
        active_turn: { id: 'turn-new', status: 'running' }, latest_turn: { id: 'turn-old', status: 'failed' },
      } }, other: { id: 'other', sessionId: 'session-other' },
    } } as unknown as typeof state);
    expect(captureRendererDiagnostics({ event_name: 'renderer.uncaught', turn_id: 'turn-old' })).toMatchObject({
      chat_id: 'one', session_id: 'session-one', turn_id: 'turn-old', turn_status: 'failed', context_kind: 'event_target',
    });
  });
  it('honors cancellation during the log flush without opening a save dialog afterward', async () => {
    let finish!: (value: DiagnosticFlushResult) => void;
    vi.mocked(flushDiagnosticsForExport).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const exporting = exportDiagnostics(request);
    expect(await cancelDiagnosticExport(request.export_id)).toBe(true);
    finish({ status: 'completed' });
    expect(await exporting).toEqual({ status: 'cancelled' });
    expect(window.ipc.invoke).not.toHaveBeenCalled();
  });

  it('passes an incomplete flush report through to the export without blocking collection', async () => {
    vi.mocked(flushDiagnosticsForExport).mockResolvedValue({ status: 'timeout', target_seq: 12, processed_seq: 7 });
    vi.mocked(window.ipc.invoke).mockResolvedValue({ status: 'partial' });
    expect(await exportDiagnostics(request)).toEqual({ status: 'partial' });
    expect(window.ipc.invoke).toHaveBeenCalledWith('diagnostics:export', expect.objectContaining({
      renderer_flush: { status: 'timeout', target_seq: 12, processed_seq: 7 },
    }));
  });
});
