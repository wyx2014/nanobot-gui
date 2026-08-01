import { describe, expect, it } from 'vitest';
import type { TurnPlanResource } from '@/core/types';
import { normalizeTurnPlan } from './planViewModel';

describe('normalizeTurnPlan', () => {
  it('clears stale active pointers and terminalizes unfinished steps', () => {
    const plan: TurnPlanResource = {
      id: 'plan:turn-1',
      turn_id: 'turn-1',
      kind: 'workflow',
      owner: 'expert_team:asset-research-team',
      policy: 'required',
      execution: 'staged',
      status: 'failed',
      revision: 9,
      active_step_ids: ['team-lead'],
      current_step_id: 'team-lead',
      steps: [
        { id: 'data-package', title: '建立基础数据包', status: 'completed' },
        { id: 'team-lead', title: '主笔交叉质证与汇总', status: 'running' },
        { id: 'report-audit', title: '报告审校与交付', status: 'pending' },
      ],
    };

    expect(normalizeTurnPlan(plan)).toMatchObject({
      status: 'failed',
      active_step_ids: [],
      current_step_id: null,
      steps: [
        { id: 'data-package', status: 'completed' },
        { id: 'team-lead', status: 'error' },
        { id: 'report-audit', status: 'skipped' },
      ],
    });
  });
});
