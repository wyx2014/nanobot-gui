import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initLanguage } from '@/i18n';
import type { TurnPlanResource } from '@/core/types';
import ExpertTeamRevisionActions from './ExpertTeamRevisionActions';

const plan: TurnPlanResource = {
  id: 'plan-byd', turn_id: 'turn-byd', kind: 'workflow', owner: 'expert_team:asset-research-team',
  policy: 'required', execution: 'staged', status: 'completed', revision: 195,
  active_step_ids: [], team_id: 'asset-research-team', team_run_id: '04db8b3226fd',
  steps: [
    { id: 'financial-analyst', title: '财务分析师', status: 'completed' },
    { id: 'risk-assessor', title: '风险评估师 · 李录视角', status: 'completed', warning: '该角色结果已降级，Team Lead 将补齐缺失维度' },
  ],
};
let container: HTMLDivElement;
let root: Root;
const revise = vi.fn();

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  initLanguage('zh-CN');
  revise.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Research report revision entry', () => {
  it('shows the degraded role directly from persisted plan, without local team metadata or expanding a timeline', () => {
    act(() => root.render(<ExpertTeamRevisionActions plan={plan} onReviseRole={revise} />));
    expect(container.textContent).toContain('有待补齐的角色结果');
    const supplement = container.querySelector<HTMLButtonElement>('button[title="补充资料"]');
    expect(supplement).not.toBeNull();
    act(() => supplement!.click());
    expect(revise).toHaveBeenLastCalledWith('04db8b3226fd', 'risk-assessor', 'supplement');
    act(() => container.querySelector<HTMLButtonElement>('button[title="仅重试该角色"]')!.click());
    expect(revise).toHaveBeenLastCalledWith('04db8b3226fd', 'risk-assessor', 'retry');
  });

  it('keeps actions visible but disabled while disconnected or busy', () => {
    act(() => root.render(<ExpertTeamRevisionActions plan={plan} disabled onReviseRole={revise} />));
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) { expect(button.disabled).toBe(true); act(() => button.click()); }
    expect(revise).not.toHaveBeenCalled();
  });

  it.each([
    { ...plan, status: 'running' as const },
    { ...plan, team_run_id: undefined },
    { ...plan, team_id: 'another-team' },
    null,
  ])('does not offer revision without a finished research run', (value) => {
    act(() => root.render(<ExpertTeamRevisionActions plan={value} onReviseRole={revise} />));
    expect(container.querySelector('button')).toBeNull();
  });
});
