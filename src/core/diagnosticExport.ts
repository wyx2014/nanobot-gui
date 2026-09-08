import { useChatStore } from '@/stores/chatStore';
import { useTaskExecutionStore } from '@/stores/taskExecutionStore';
import { getNanobotConnectionStatus } from './nanobotClient';
import { flushDiagnosticsForExport, recordDiagnostic, setDiagnosticSnapshotProvider } from './diagnostics';
import type { DiagnosticInput } from '@/shared/diagnostics';
import type { DiagnosticExportRequest, DiagnosticExportResult, ExportStage, RendererDiagnosticSnapshot } from '@/shared/diagnosticBundle';

export function captureRendererDiagnostics(event?: DiagnosticInput): RendererDiagnosticSnapshot {
  const state = useChatStore.getState();
  const targeted = event?.chat_id || event?.session_id || event?.turn_id;
  const conversation = targeted ? Object.values(state.conversations).find((item) =>
    (!event.chat_id || item.id === event.chat_id) && (!event.session_id || item.sessionId === event.session_id)
    && (!event.turn_id || [item.runtimeSnapshot?.active_turn?.id, item.runtimeSnapshot?.latest_turn?.id].includes(event.turn_id)))
    : state.activeConversationId ? state.conversations[state.activeConversationId] : undefined;
  const runtime = conversation?.runtimeSnapshot;
  const currentTurn = runtime?.active_turn ?? runtime?.latest_turn;
  const stepsMatchTurn = !event?.turn_id || event.turn_id === currentTurn?.id;
  const turn = event?.turn_id ? [runtime?.active_turn, runtime?.latest_turn].find((item) => item?.id === event.turn_id)
    : runtime?.active_turn ?? runtime?.latest_turn;
  const executions = Object.values(useTaskExecutionStore.getState().executions)
    .filter((execution) => execution.conversationId === conversation?.id)
    .sort((a, b) => b.startTime - a.startTime);
  const steps = executions[0]?.steps ?? [];
  const last = stepsMatchTurn ? steps.at(-1) : undefined;
  return {
    captured_at: new Date().toISOString(), connection_status: getNanobotConnectionStatus(),
    context_kind: targeted ? 'event_target' : 'active_view',
    chat_id: conversation?.id, session_id: conversation?.sessionId, project_id: conversation?.projectId,
    trace_id: turn?.trace_id ?? undefined, turn_id: turn?.id, runtime_epoch: runtime?.runtime_epoch ?? undefined,
    snapshot_revision: runtime?.snapshot_revision, conversation_status: conversation?.status,
    turn_status: turn?.status, turn_started_at: turn?.started_at, step_count: stepsMatchTurn ? steps.length : undefined,
    last_step_status: last?.status, last_step_type: last?.type, last_progress_at: last?.endTime ?? last?.startTime,
  };
}

export function installIncidentContext(): () => void {
  setDiagnosticSnapshotProvider((event) => ({ ...captureRendererDiagnostics(event) }));
  const capture = () => {
    const snapshot = captureRendererDiagnostics();
    recordDiagnostic({ event_name: 'renderer.context', chat_id: snapshot.chat_id, session_id: snapshot.session_id,
      details: { context_snapshot: snapshot } });
  };
  capture();
  const timer = setInterval(capture, 10_000);
  return () => { clearInterval(timer); setDiagnosticSnapshotProvider(undefined); };
}

const preparing = new Map<string, { cancelled: boolean }>();

export async function exportDiagnostics(request: DiagnosticExportRequest): Promise<DiagnosticExportResult> {
  if (preparing.has(request.export_id)) return { status: 'failed', error_code: 'EXPORT_ALREADY_RUNNING' };
  const preparation = { cancelled: false };
  preparing.set(request.export_id, preparation);
  try {
    const renderer_flush = await flushDiagnosticsForExport();
    if (preparation.cancelled) return { status: 'cancelled' };
    // No await between handing ownership to main and sending the export IPC.
    preparing.delete(request.export_id);
    return await window.ipc.invoke('diagnostics:export', { ...request, renderer_flush });
  } finally { if (preparing.get(request.export_id) === preparation) preparing.delete(request.export_id); }
}

export async function cancelDiagnosticExport(id: string): Promise<boolean> {
  const preparation = preparing.get(id);
  if (preparation) { preparation.cancelled = true; return true; }
  return window.ipc.invoke('diagnostics:cancel-export', id);
}

export function onDiagnosticExportProgress(callback: (event: { export_id: string; stage: ExportStage }) => void) {
  return window.ipc?.on('diagnostics:export-progress', callback) ?? (() => {});
}
