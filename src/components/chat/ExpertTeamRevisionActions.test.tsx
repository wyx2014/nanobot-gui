import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initLanguage } from '@/i18n';
import type { TurnPlanResource } from '@/core/types';
import ExpertTeamRevisionActions, { RoleRevisionActions } from './ExpertTeamRevisionActions';

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
const roleProps = {
  runId: '04db8b3226fd',
  roleId: 'risk-assessor',
  roleTitle: '风险评估师 · 李录视角',
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  initLanguage('zh-CN');
  revise.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('RoleRevisionActions', () => {
  it('passes the exact run and role to the revision action', () => {
    act(() => root.render(<RoleRevisionActions {...roleProps} onReviseRole={revise} />));
    const supplement = container.querySelector<HTMLButtonElement>('button[title="补充资料"]');
    expect(supplement?.getAttribute('aria-label')).toContain(roleProps.roleTitle);
    act(() => supplement!.click());
    expect(revise).toHaveBeenLastCalledWith('04db8b3226fd', 'risk-assessor');
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  it('keeps actions visible but disabled while disconnected or busy', () => {
    act(() => root.render(<RoleRevisionActions {...roleProps} disabled onReviseRole={revise} />));
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons).toHaveLength(1);
    for (const button of buttons) { expect(button.disabled).toBe(true); act(() => button.click()); }
    expect(revise).not.toHaveBeenCalled();
  });
});

describe('Research report revision actions', () => {
  it('shows only the right-aligned actions for a finished research run', () => {
    act(() => root.render(<ExpertTeamRevisionActions plan={plan} onReviseRole={revise} />));
    const actions = container.querySelector('[data-research-revision-actions]');
    expect(actions?.className).toContain('justify-end');
    expect(actions?.textContent).toBe('补充资料');
    expect(actions?.textContent).not.toContain('研究报告');
    expect(actions?.textContent).not.toContain('风险评估师');
    expect(actions?.querySelectorAll('button')).toHaveLength(1);
    act(() => actions?.querySelector<HTMLButtonElement>('button[title="补充资料"]')?.click());
    expect(revise).toHaveBeenCalledWith('04db8b3226fd', 'risk-assessor');
  });

  it('disables the retained actions while the conversation is busy', () => {
    act(() => root.render(<ExpertTeamRevisionActions plan={plan} disabled onReviseRole={revise} />));
    expect([...container.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
  });

  it.each([
    { ...plan, status: 'running' as const },
    { ...plan, team_run_id: undefined },
    { ...plan, team_id: 'another-team' },
    null,
  ])('does not show actions without a finished research run', (value) => {
    act(() => root.render(<ExpertTeamRevisionActions plan={value} onReviseRole={revise} />));
    expect(container.querySelector('[data-research-revision-actions]')).toBeNull();
  });
});
