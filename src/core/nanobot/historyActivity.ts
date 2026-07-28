import type { AgentUIBlob, TaskProgressStep, UIMessage } from '@/core/types';

type PlanActivityState = 'running' | 'terminal' | 'unknown';

function latestUserTurn(messages: UIMessage[]): UIMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return messages.slice(index + 1);
  }
  return messages;
}

function taskProgressState(agentUI: AgentUIBlob | undefined): PlanActivityState {
  if (agentUI?.kind !== 'task_progress') return 'unknown';
  const status = agentUI.status;
  if (status === 'completed' || status === 'failed' || status === 'interrupted') {
    return 'terminal';
  }
  const steps = Array.isArray(agentUI.steps) ? agentUI.steps : [];
  const hasActiveStep = (
    (Array.isArray(agentUI.active_step_ids) && agentUI.active_step_ids.length > 0)
    || (typeof agentUI.current_step_id === 'string' && !!agentUI.current_step_id.trim())
    || steps.some((step) => step.status === 'running')
  );
  if (hasActiveStep) return 'running';
  if (status === 'running' || status === 'inProgress' || status === 'pending' || status === 'created') {
    return 'running';
  }
  if (steps.length > 0 && steps.every(stepIsTerminal)) return 'terminal';
  return 'unknown';
}

function stepIsTerminal(step: TaskProgressStep): boolean {
  return (
    step.status === 'completed'
    || step.status === 'error'
    || step.status === 'skipped'
    || step.status === 'interrupted'
  );
}

function hasExplicitPendingActivity(messages: UIMessage[]): boolean {
  const latestToolPhase = new Map<string, string>();
  let anonymousToolStart = false;

  for (const message of messages) {
    if (message.isStreaming || message.reasoningStreaming || message.narrationStreaming) {
      return true;
    }
    if (message.fileEdits?.some((edit) => edit.status === 'editing' || edit.pending)) {
      return true;
    }
    for (const event of message.toolEvents ?? []) {
      const phase = typeof event.phase === 'string' ? event.phase : '';
      const callId = typeof event.call_id === 'string' ? event.call_id.trim() : '';
      if (!callId) {
        if (phase === 'start') anonymousToolStart = true;
        continue;
      }
      latestToolPhase.set(callId, phase);
    }
  }

  return (
    anonymousToolStart
    || [...latestToolPhase.values()].some((phase) => phase === 'start')
  );
}

/**
 * Infer whether a replayed thread still has live work only when no Runtime
 * Snapshot is available. A trace row is evidence that work happened, not that
 * it is still running.
 */
export function historyHasPendingActivity(messages: UIMessage[]): boolean {
  const turnMessages = latestUserTurn(messages);
  let latestPlanIndex = -1;
  let latestPlanState: PlanActivityState = 'unknown';

  for (let index = turnMessages.length - 1; index >= 0; index -= 1) {
    const state = taskProgressState(turnMessages[index].agentUI);
    if (state === 'unknown') continue;
    latestPlanIndex = index;
    latestPlanState = state;
    break;
  }

  if (latestPlanState === 'running') return true;
  if (latestPlanState === 'terminal') {
    // A terminal plan closes all preceding activity. Only an explicit live
    // frame emitted after that terminal marker may reopen the turn.
    return hasExplicitPendingActivity(turnMessages.slice(latestPlanIndex + 1));
  }
  return hasExplicitPendingActivity(turnMessages);
}
