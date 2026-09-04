import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SecurityApprovalCard from './SecurityApprovalCard';

const approval = {
  approval_id: 'sap_123',
  tool_call_id: 'call_1',
  tool_name: 'exec',
  risk: 'high',
  rule_id: 'command.recursive_delete',
  summary: '递归或批量删除可能造成数据丢失',
  target: 'rm -rf /work/output',
  scope: 'turn' as const,
  status: 'pending' as const,
};

describe('SecurityApprovalCard', () => {
  const container = document.createElement('div');
  const root = createRoot(container);

  afterEach(() => {
    act(() => root.render(<></>));
  });

  it('shows the target and submits the turn-scoped decision once', () => {
    const onRespond = vi.fn(() => true);
    act(() => root.render(<SecurityApprovalCard approval={approval} onRespond={onRespond} />));

    expect(container.textContent).toContain('确认高风险操作');
    expect(container.textContent).toContain('命令执行');
    expect(container.textContent).toContain('递归或批量删除可能造成数据丢失');
    expect(container.textContent).toContain('rm -rf /work/output');
    expect(container.textContent).toContain('仅对当前轮同类操作有效');
    const allow = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('允许本轮同类操作'));
    act(() => allow?.click());
    act(() => allow?.click());

    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith('allow_turn');
  });

  it('keeps the approval active when a response is not accepted', () => {
    const onRespond = vi.fn(() => false);
    act(() => root.render(<SecurityApprovalCard approval={approval} onRespond={onRespond} />));

    const deny = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('拒绝'));
    act(() => deny?.click());
    act(() => deny?.click());

    expect(onRespond).toHaveBeenCalledTimes(2);
    expect(onRespond).toHaveBeenCalledWith('deny');
    expect(deny?.hasAttribute('disabled')).toBe(false);
  });
});
