import { useChatStore } from '@/stores/chatStore';
import { useTaskExecutionStore } from '@/stores/taskExecutionStore';
import { getNanobotConnectionStatus } from './nanobotClient';
import { flushDiagnostics } from './diagnostics';
import type { DiagnosticExportRequest, DiagnosticExportResult, ExportStage, RendererDiagnosticSnapshot } from '@/shared/diagnosticBundle';

export function captureRendererDiagnostics(): RendererDiagnosticSnapshot {
  const state = useChatStore.getState();
  const conversation = state.activeConversationId ? state.conversations[state.activeConversationId] : undefined;
  const runtime = conversation?.runtimeSnapshot;
  const turn = runtime?.active_turn ?? runtime?.latest_turn;
  const executions = Object.values(useTaskExecutionStore.getState().executions)
    .filter((execution) => execution.conversationId === conversation?.id)
    .sort((a, b) => b.startTime - a.startTime);
  const steps = executions[0]?.steps ?? [];
  const last = steps.at(-1);
  return {
    captured_at: new Date().toISOString(), connection_status: getNanobotConnectionStatus(),
    chat_id: conversation?.id, session_id: conversation?.sessionId, project_id: conversation?.projectId,
    trace_id: turn?.trace_id ?? undefined, turn_id: turn?.id, runtime_epoch: runtime?.runtime_epoch ?? undefined,
    snapshot_revision: runtime?.snapshot_revision, conversation_status: conversation?.status,
    turn_status: turn?.status, turn_started_at: turn?.started_at, step_count: steps.length,
    last_step_status: last?.status, last_step_type: last?.type, last_progress_at: last?.endTime ?? last?.startTime,
  };
}

export function exportDiagnostics(request: DiagnosticExportRequest): Promise<DiagnosticExportResult> {
  flushDiagnostics();
  return window.ipc.invoke('diagnostics:export', request);
}

export function cancelDiagnosticExport(id: string): Promise<boolean> {
  return window.ipc.invoke('diagnostics:cancel-export', id);
}

export function onDiagnosticExportProgress(callback: (event: { export_id: string; stage: ExportStage }) => void) {
  return window.ipc?.on('diagnostics:export-progress', callback) ?? (() => {});
}
