import { describe, expect, it } from 'vitest';
import type { UIMessage } from '@/core/types';
import { historyHasPendingActivity } from './historyActivity';

function completedExpertPlan(): UIMessage {
  return {
    id: 'team-terminal-plan',
    role: 'tool',
    kind: 'trace',
    content: '',
    createdAt: 3,
    agentUI: {
      kind: 'task_progress',
      plan_kind: 'workflow',
      team_id: 'asset-research-team',
      status: 'completed',
      active_step_ids: [],
      note: '研究与报告已完成',
      steps: [
        { id: 'financial-analyst', title: '财务分析师', status: 'completed' },
        { id: 'team-lead', title: '主笔交叉质证与汇总', status: 'completed' },
        { id: 'report-audit', title: '报告审校与交付', status: 'completed' },
      ],
    },
  };
}

describe('historyHasPendingActivity', () => {
  it('does not resurrect a completed expert team whose final row is a trace', () => {
    expect(historyHasPendingActivity([
      { id: 'user', role: 'user', content: '分析公司', createdAt: 1 },
      { id: 'answer', role: 'assistant', content: '报告已生成', createdAt: 2 },
      completedExpertPlan(),
    ])).toBe(false);
  });

  it('lets a terminal plan close unmatched historical tool starts', () => {
    expect(historyHasPendingActivity([
      { id: 'user', role: 'user', content: '分析公司', createdAt: 1 },
      {
        id: 'old-start',
        role: 'tool',
        kind: 'trace',
        content: '',
        createdAt: 2,
        toolEvents: [{ phase: 'start', call_id: 'search-1', name: 'web_search' }],
      },
      completedExpertPlan(),
    ])).toBe(false);
  });

  it('keeps a running plan active', () => {
    expect(historyHasPendingActivity([{
      id: 'running-plan',
      role: 'tool',
      kind: 'trace',
      content: '',
      createdAt: 1,
      agentUI: {
        kind: 'task_progress',
        status: 'running',
        active_step_ids: ['research'],
        current_step_id: 'research',
        steps: [{ id: 'research', title: '查询资料', status: 'running' }],
      },
    }])).toBe(true);
  });

  it('detects only genuinely unclosed tool calls when no plan exists', () => {
    const start: UIMessage = {
      id: 'start',
      role: 'tool',
      kind: 'trace',
      content: '',
      createdAt: 1,
      toolEvents: [{ phase: 'start', call_id: 'search-1', name: 'web_search' }],
    };
    expect(historyHasPendingActivity([start])).toBe(true);
    expect(historyHasPendingActivity([
      start,
      {
        id: 'end',
        role: 'tool',
        kind: 'trace',
        content: '',
        createdAt: 2,
        toolEvents: [{ phase: 'end', call_id: 'search-1', name: 'web_search' }],
      },
    ])).toBe(false);
  });
});
