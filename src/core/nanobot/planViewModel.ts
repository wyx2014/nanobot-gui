import type {
  AgentUIBlob,
  TaskProgressStatus,
  TurnPlanResource,
  TurnPlanStepResource,
} from '@/core/types';

function normalizeStepStatus(
  status: TurnPlanStepResource['status'] | string,
): TaskProgressStatus {
  if (status === 'inProgress') return 'running';
  if (status === 'failed' || status === 'cancelled') {
    return status === 'failed' ? 'error' : 'interrupted';
  }
  if (
    status === 'pending'
    || status === 'running'
    || status === 'completed'
    || status === 'error'
    || status === 'skipped'
    || status === 'interrupted'
  ) {
    return status;
  }
  return 'pending';
}

export function normalizeTurnPlan(plan: TurnPlanResource): TurnPlanResource {
  const steps = Array.isArray(plan.steps)
    ? plan.steps
      .filter((step) => !!step?.id && !!step?.title?.trim())
      .map((step, ordinal) => ({
        ...step,
        ordinal: step.ordinal ?? ordinal,
        title: step.title.trim(),
        status: normalizeStepStatus(step.status),
      }))
    : [];
  const activeStepIds = Array.isArray(plan.active_step_ids)
    ? plan.active_step_ids.filter((id): id is string => typeof id === 'string' && !!id.trim())
    : steps.filter((step) => step.status === 'running').map((step) => step.id);
  return {
    ...plan,
    id: plan.id || `plan:${plan.turn_id}`,
    kind: plan.kind === 'workflow' ? 'workflow' : 'dynamic',
    owner: plan.owner || 'agent',
    policy: plan.policy === 'optional' ? 'optional' : 'required',
    execution: (
      plan.execution === 'parallel' || plan.execution === 'staged'
        ? plan.execution
        : 'serial'
    ),
    revision: Math.max(1, Number(plan.revision) || 1),
    active_step_ids: activeStepIds,
    steps,
  };
}

export function planFromAgentUI(
  agentUI: AgentUIBlob | undefined,
  fallbackTurnId: string,
): TurnPlanResource | null {
  if (agentUI?.kind !== 'task_progress' || !Array.isArray(agentUI.steps)) return null;
  const ui = agentUI as {
    kind: 'task_progress';
    steps: TurnPlanStepResource[];
    plan_id?: string;
    turn_id?: string;
    plan_kind?: 'dynamic' | 'workflow';
    owner?: string;
    policy?: 'optional' | 'required';
    execution?: 'serial' | 'parallel' | 'staged';
    status?: TurnPlanResource['status'];
    revision?: number;
    active_step_ids?: string[];
    current_step_id?: string;
    note?: string;
    team_id?: string;
    team_run_id?: string;
  };
  const turnId = ui.turn_id?.trim() || fallbackTurnId;
  if (!turnId) return null;
  const workflow = (
    ui.plan_kind === 'workflow'
    || typeof ui.team_id === 'string'
    || typeof ui.team_run_id === 'string'
  );
  const activeStepIds = ui.active_step_ids?.length
    ? ui.active_step_ids
    : ui.steps.filter((step) => step.status === 'running').map((step) => step.id);
  const status = ui.status ?? (
    ui.steps.some((step) => step.status === 'error')
      ? 'failed'
      : ui.steps.every((step) => step.status === 'completed')
        ? 'completed'
        : 'running'
  );
  return normalizeTurnPlan({
    id: ui.plan_id || `plan:${turnId}`,
    turn_id: turnId,
    kind: workflow ? 'workflow' : 'dynamic',
    owner: ui.owner || (workflow ? `expert_team:${ui.team_id || ''}` : 'agent'),
    policy: ui.policy || 'required',
    execution: ui.execution || (workflow ? 'staged' : 'serial'),
    status,
    revision: ui.revision ?? 1,
    active_step_ids: activeStepIds,
    current_step_id: ui.current_step_id,
    note: ui.note,
    steps: ui.steps,
    team_id: ui.team_id,
    team_run_id: ui.team_run_id,
  });
}
