import type { TurnPlanResource } from '@/core/types';

const MEMBER_IDS = new Set([
  'business-analyst', 'financial-analyst', 'industry-researcher', 'risk-assessor',
]);

export function researchRevisionSource(plan?: TurnPlanResource | null) {
  if (!plan?.team_run_id
    || (plan.team_id ?? plan.owner.replace(/^expert_team:/, '')) !== 'asset-research-team'
    || !['completed', 'failed', 'interrupted'].includes(plan.status)) return null;

  const roles = plan.steps.filter((step) => MEMBER_IDS.has(step.id));
  if (!roles.length) return null;
  const attentionRoles = roles.filter((step) => (
    Boolean(step.warning) || step.status !== 'completed'
    || /降级|degraded/i.test(step.detail ?? '')
  ));
  return {
    runId: plan.team_run_id,
    roles,
    attentionRoles,
    defaultRole: attentionRoles[0] ?? roles[0],
  };
}
