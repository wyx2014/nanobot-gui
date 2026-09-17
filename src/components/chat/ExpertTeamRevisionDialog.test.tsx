import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpertTeamRevisionContext, ExpertTeamRevisionPlan } from '@/core/types';
import ExpertTeamRevisionDialog from './ExpertTeamRevisionDialog';

const client = vi.hoisted(() => ({ revisionContext: vi.fn(), prepareRevision: vi.fn(), discardRevision: vi.fn() }));
vi.mock('@/core/nanobotClient', () => ({ getNanobotClient: () => client }));

const context: ExpertTeamRevisionContext = {
  run_id: 'old', target: '比亚迪', version: 1, checkpoint_revision: 7, base_cached: false,
  reported_gaps: ['iFinD数据 | 缺失 | 本轮超限停用', 'iFinD数据 | 缺失 | 本轮超限停用'], original_report: 'reports/v1.html',
  research_period: '2026 年中报', security_identity: '比亚迪（002594.SZ）',
  roles: [
    { id: 'financial-analyst', name: '财务分析师', status: 'completed', reason: '完成', cached: true, recommended_materials: [] },
    {
      id: 'risk-assessor', name: '风险评估师', status: 'failed', reason: '执行超时', cached: true, recommended_materials: ['有息负债'],
      framework: '李录视角', framework_source: '团队角色研究要求', framework_prompt: '核验管理层资本配置与永久损失风险',
      material_requests: [{ title: '有息负债到期结构', status: 'reported', data: '提供未来一年到期金额及受限现金', period: '2026H1', purpose: '评估偿债资金缺口', source: '公司中报附注及页码', basis: '当前角色报告明确待核验' }],
      research_prompt: '请为比亚迪（002594.SZ）补充风险评估师资料。\n研究框架：核验管理层资本配置与永久损失风险\n资料清单：有息负债到期结构\n来源链接与页码',
    },
  ],
};
const plan: ExpertTeamRevisionPlan = {
  plan_id: 'plan-1', run_id: 'old', target: '比亚迪', version: 2,
  selected_roles: ['risk-assessor'], reused_roles: ['financial-analyst'],
  base_cached: false, materials: [], original_report: 'reports/v1.html',
};
let root: Root;
let container: HTMLDivElement;
const start = vi.fn();
const close = vi.fn();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

async function render(chatId = 'byd') {
  await act(async () => root.render(<ExpertTeamRevisionDialog key={chatId} chatId={chatId} runId="old" roleId="risk-assessor" onClose={close} onStart={start} />));
}

beforeEach(() => {
  vi.clearAllMocks();
  client.revisionContext.mockResolvedValue(context);
  client.prepareRevision.mockResolvedValue(plan);
  start.mockReturnValue(true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('ExpertTeamRevisionDialog', () => {
  it('shows concrete role needs and copies a self-contained prompt without starting research', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await render();
    expect(document.body.textContent).not.toContain('iFinD');
    expect(document.body.textContent).not.toContain('原报告中的待核验记录');
    expect(document.body.textContent).toContain('有息负债到期结构');
    expect(document.body.textContent).toContain('未来一年到期金额及受限现金');
    expect(document.body.textContent).toContain('评估偿债资金缺口');
    expect(document.body.textContent).toContain('公司中报附注及页码');
    expect(document.body.textContent).toContain('李录视角');
    await act(async () => button('复制提示词').click());
    expect(writeText).toHaveBeenCalledWith(context.roles[1].research_prompt);
    expect(document.body.textContent).toContain('已复制');
    expect(client.prepareRevision).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('includes a changed research period in the copied prompt', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await render();
    const period = document.querySelector<HTMLInputElement>('input[maxlength="120"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(period, '2025 年报');
      period.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('复制提示词').click());
    expect(writeText.mock.calls[0][0]).toContain('本次指定资料期间：2025 年报');
    expect(writeText.mock.calls[0][0]).toContain('002594.SZ');
    expect(client.prepareRevision).not.toHaveBeenCalled();
  });

  it('opens a selectable prompt when clipboard access fails', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await render();
    await act(async () => button('复制提示词').click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('剪贴板不可用');
    const preview = document.querySelector<HTMLTextAreaElement>('textarea[readonly]')!;
    expect(preview.value).toContain('002594.SZ');
    expect(preview.closest('details')?.open).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });

  it('does not start research when adding a file or preparing the scope', async () => {
    await render();
    expect(document.body.textContent).toContain('执行超时');
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['cash data'], 'cash.csv', { type: 'text/csv' })] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(document.body.textContent).toContain('cash.csv');
    expect(client.prepareRevision).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    await act(async () => {
      button('查看更新范围').click();
      await vi.waitFor(() => expect(client.prepareRevision).toHaveBeenCalledOnce());
    });
    expect(client.prepareRevision.mock.calls[0][1]).toMatchObject({ roles: ['risk-assessor'], files: [{ name: 'cash.csv', base64: btoa('cash data') }] });
    expect(document.body.textContent).toContain('复用');
    expect(document.body.textContent).toContain('财务分析师');
    expect(start).not.toHaveBeenCalled();
    act(() => { button('确认更新 v2').click(); button('确认更新 v2').click(); });
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(plan);
  });

  it('displays preparation rejection and never offers confirmation', async () => {
    client.prepareRevision.mockRejectedValue(new Error('原研究已变化'));
    await render();
    await act(async () => button('查看更新范围').click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('原研究已变化');
    expect(document.body.textContent).not.toContain('确认更新 v2');
    expect(start).not.toHaveBeenCalled();
  });

  it('discards a late plan after switching conversations', async () => {
    let resolve!: (value: ExpertTeamRevisionPlan) => void;
    client.prepareRevision.mockReturnValue(new Promise((done) => { resolve = done; }));
    await render();
    await act(async () => button('查看更新范围').click());
    await render('other');
    await act(async () => resolve(plan));
    expect(document.body.textContent).not.toContain('确认更新 v2');
    expect(client.discardRevision).toHaveBeenCalledWith('byd', 'plan-1');
    expect(start).not.toHaveBeenCalled();
  });

  it('allows expanding the scope for shared financial corrections', async () => {
    await render();
    const shared = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1)!;
    act(() => shared.click());
    await act(async () => button('查看更新范围').click());
    expect(client.prepareRevision.mock.calls[0][1].roles).toEqual(['financial-analyst', 'risk-assessor']);
  });
});
