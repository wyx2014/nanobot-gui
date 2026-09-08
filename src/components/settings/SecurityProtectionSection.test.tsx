import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchSecurityAudit, fetchSecurityPolicy, updateSecurityPolicy } from '@/core/api';
import type { SecurityPolicyPayload } from '@/core/types';
import SecurityProtectionSection from './SecurityProtectionSection';

vi.mock('@/core/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/api')>();
  return {
    ...actual,
    fetchSecurityPolicy: vi.fn(),
    fetchSecurityAudit: vi.fn(),
    updateSecurityPolicy: vi.fn(),
  };
});

describe('SecurityProtectionSection', () => {
  let container: HTMLDivElement;
  let root: Root;
  let policy: SecurityPolicyPayload;

  const render = async (token = 'gateway-token', apiBase = 'http://127.0.0.1:8900') => {
    await act(async () => root.render(<SecurityProtectionSection token={token} apiBase={apiBase} isEnglish={false} />));
  };
  const button = (label: string) => {
    const found = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.includes(label) || item.getAttribute('aria-label') === label);
    expect(found, label).toBeDefined();
    return found!;
  };
  const waitForAuditLoad = async () => {
    await act(async () => {
      await vi.waitFor(() => {
        expect(fetchSecurityAudit).toHaveBeenCalled();
      });
    });
    expect(container.textContent).not.toContain('正在读取审计记录');
  };
  const openAudit = async () => {
    await act(async () => button('审计中心').click());
    await waitForAuditLoad();
  };

  beforeEach(() => {
    container = document.createElement('div');
    root = createRoot(container);
    policy = {
      protection_enabled: true,
      enforcement_level: 'application',
      access_mode: 'full',
      core_protection_locked: true,
      file_allow_paths: [],
      approval_paths: [
        { path: '/Users/test/.ssh', source: 'default' },
        { path: '/Users/test/Finance', source: 'user' },
      ],
      command_allow_prefixes: [],
      command_approval_prefixes: [],
      network_block_all: false,
      network_allow_domains: [],
      network_deny_domains: [],
      components: { file: { enabled: true }, command: { enabled: true }, network: { enabled: true }, audit: { enabled: true } },
      core_rules: [
        { id: 'core.disk_destroy', label: '磁盘与分区破坏', locked: true },
      ],
    };
    vi.mocked(fetchSecurityPolicy).mockResolvedValue(policy);
    vi.mocked(fetchSecurityAudit).mockResolvedValue({
      events: [],
      total: 0,
      loaded: 0,
      next_cursor: null,
    });
    vi.mocked(updateSecurityPolicy).mockResolvedValue(policy);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.clearAllMocks();
  });

  it('shows protection without Full Access and configures both file path lists', async () => {
    await act(async () => {
      root.render(
        <SecurityProtectionSection
          token="gateway-token"
          apiBase="http://127.0.0.1:8900"
          isEnglish={false}
        />,
      );
    });

    expect(container.textContent).toContain('已读取安全策略');
    expect(container.textContent).not.toContain('Full Access');
    expect(container.textContent).not.toContain('始终开启');
    expect(container.textContent).toContain('2 个强制审批目录，0 个自动放行目录');
    expect(container.textContent).toContain('通过安全检查后放行');
    expect(container.textContent).toContain('上次确认');
    expect(container.textContent).not.toContain('保留 3 年');

    const fileSecurity = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('文件安全'));
    act(() => fileSecurity?.click());

    expect(container.textContent).toContain('强制审批目录');
    expect(container.textContent).toContain('自动放行白名单');
    expect(container.textContent).toContain('命中路径会按低风险处理并自动放行');
    expect(container.textContent).toContain('/Users/test/.ssh');
    expect(container.textContent).toContain('系统保护');
  });

  it('opens functional command and network rule pages', async () => {
    await act(async () => {
      root.render(
        <SecurityProtectionSection
          token="gateway-token"
          apiBase="http://127.0.0.1:8900"
          isEnglish={false}
        />,
      );
    });

    const commandSecurity = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('命令安全'));
    act(() => commandSecurity?.click());
    expect(container.textContent).toContain('放行前缀');
    expect(container.textContent).toContain('询问前缀');
    expect(container.textContent).toContain('核心硬拦截和强制审批路径始终优先');

    const back = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('安全防护概览'));
    act(() => back?.click());
    const networkSecurity = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('网络安全'));
    act(() => networkSecurity?.click());
    expect(container.textContent).toContain('默认阻断受控工具联网');
    expect(container.textContent).toContain('允许域名');
    expect(container.textContent).toContain('拒绝域名');
    expect(container.textContent).toContain('不能替代操作系统防火墙');
  });

  it('reflects configured restrictions and handles missing component declarations', async () => {
    vi.mocked(fetchSecurityPolicy).mockResolvedValue({ ...policy, network_block_all: true, network_deny_domains: ['example.com'], components: { ...policy.components, audit: { enabled: false } } });
    await render();
    expect(container.textContent).toContain('受控请求默认阻断');
    expect(container.textContent).toContain('1 个拒绝域名');
    expect(button('审计中心').textContent).toContain('配置未启用');
    vi.mocked(fetchSecurityPolicy).mockResolvedValue({ ...policy, components: {} });
    await act(async () => button('刷新安全策略').click());
    expect(button('文件安全').textContent).toContain('未返回启用状态');
  });

  it('finishes loading without credentials and recovers when connected', async () => {
    await render('');
    expect(fetchSecurityPolicy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('本地服务尚未连接');
    expect(container.textContent).not.toContain('正在读取');
    await render();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(fetchSecurityPolicy).toHaveBeenCalledWith('gateway-token', 'http://127.0.0.1:8900');
  });

  it('marks a failed refresh as a previous snapshot and requires recovery before editing', async () => {
    await render();
    vi.mocked(fetchSecurityPolicy).mockRejectedValueOnce(new Error('gateway offline'));
    await act(async () => button('刷新安全策略').click());
    expect(container.textContent).toContain('当前策略尚未确认');
    expect(container.textContent).toContain('（上次快照）');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('gateway offline');
    act(() => button('网络安全').click());
    expect(container.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true);
    await act(async () => button('重试').click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(false);
  });

  it('discards an old service response after the connection changes', async () => {
    let finishOld!: (value: SecurityPolicyPayload) => void;
    vi.mocked(fetchSecurityPolicy).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    await render();
    await render('new-token', 'http://127.0.0.1:8901');
    await act(async () => finishOld({ ...policy, network_block_all: true }));
    expect(container.textContent).toContain('通过安全检查后放行');
    expect(container.textContent).not.toContain('受控请求默认阻断');
  });

  it.each([
    ['命令安全', '放行前缀', 'git push origin', 'command_allow_prefixes'],
    ['网络安全', '允许域名', 'example.com', 'network_allow_domains'],
  ] as const)('retains failed rule input and prevents duplicate saves in %s', async (page, label, value, key) => {
    await render();
    act(() => button(page).click());
    const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    let rejectSave!: (reason: Error) => void;
    vi.mocked(updateSecurityPolicy).mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(updateSecurityPolicy).toHaveBeenCalledTimes(1);
    expect(input.disabled).toBe(true);
    await act(async () => rejectSave(new Error('save rejected')));
    expect(input.value).toBe(value);
    expect(input.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('save rejected');
    expect(container.querySelector('code')).toBeNull();
    vi.mocked(updateSecurityPolicy).mockResolvedValue({ ...policy, [key]: [value] });
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(updateSecurityPolicy).toHaveBeenLastCalledWith('gateway-token', 'http://127.0.0.1:8900', { [key]: [value] });
    expect(input.value).toBe('');
    expect(container.querySelector('code')?.textContent).toBe(value);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('does not optimistically enable network blocking after a rejected save', async () => {
    await render();
    act(() => button('网络安全').click());
    vi.mocked(updateSecurityPolicy).mockRejectedValueOnce(new Error('connection failed'));
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
    expect(container.textContent).toContain('策略保存未确认');
    expect(container.textContent).toContain('列表为空不表示禁止联网');
  });

  it.each([
    ['文件安全', '恢复系统默认', '保留系统保护目录', { file_allow_paths: [], approval_paths: [] }],
    ['命令安全', '重置默认', '保留内置风险检查', { command_allow_prefixes: [], command_approval_prefixes: [] }],
    ['网络安全', '重置默认', '可访问的目标可能增加', { network_block_all: false, network_allow_domains: [], network_deny_domains: [] }],
  ])('confirms the reset scope for %s', async (page, resetLabel, scope, update) => {
    await render();
    act(() => button(page as string).click());
    act(() => button(resetLabel as string).click());
    expect(container.querySelector('[data-confirm-dialog]')?.textContent).toContain(scope);
    expect(updateSecurityPolicy).not.toHaveBeenCalled();
    act(() => button('取消').click());
    expect(container.querySelector('[data-confirm-dialog]')).toBeNull();
    expect(updateSecurityPolicy).not.toHaveBeenCalled();
    act(() => button(resetLabel as string).click());
    await act(async () => button('确认恢复').click());
    expect(updateSecurityPolicy).toHaveBeenCalledExactlyOnceWith('gateway-token', 'http://127.0.0.1:8900', update);
  });

  it('distinguishes prevention from execution errors without inventing live approvals', async () => {
    const outcomes = [
      ['blocked', 'block'], ['denied', 'denied'], ['timed_out', 'timed_out'],
      ['failed', 'allow'], ['timed_out', 'allow'], ['pending', 'require_approval'],
    ];
    vi.mocked(fetchSecurityAudit).mockResolvedValue({
      events: outcomes.map(([result, decision], index) => ({ id: index, timestamp: Date.now(), category: 'network', action: 'connect', result, decision, summary: 'assessment', risk: 'normal', details: {} })),
      total: 6, loaded: 6, next_cursor: null,
    });
    await render();
    await openAudit();
    expect(container.textContent).toContain('当前页已拦截或未获授权 3 条');
    expect(container.textContent).toContain('当前页执行异常 2 条');
    expect(container.textContent).toContain('尚无完成记录');
    expect(container.textContent).toContain('审批已超时');
    expect(container.textContent).not.toContain('需关注');
  });

  it('shows an audit load error instead of claiming there are no records and can retry', async () => {
    vi.mocked(fetchSecurityAudit).mockRejectedValueOnce(new Error('audit unavailable'));
    await render();
    await openAudit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('audit unavailable');
    expect(container.textContent).not.toContain('暂无匹配的审计记录');
    expect(container.textContent).not.toContain('共 0 条记录');
    await act(async () => button('刷新').click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('暂无匹配的审计记录');
  });

  it('offers all five audit categories', async () => {
    await act(async () => {
      root.render(
        <SecurityProtectionSection
          token="gateway-token"
          apiBase="http://127.0.0.1:8900"
          isEnglish={false}
        />,
      );
    });

    const auditCenter = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('审计中心'));
    await act(async () => auditCenter?.click());

    const typeSelect = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === '全部类型');
    act(() => typeSelect?.click());

    expect(container.textContent).toContain('文件访问与修改');
    expect(container.textContent).toContain('命令与系统操作');
    expect(container.textContent).toContain('联网与数据流转');
    expect(container.textContent).toContain('安全决策与授权');
    expect(container.textContent).toContain('安全设置与审计管理');
    expect(container.textContent).not.toContain('MCP');
  });

  it('renders concise audit rows with expandable details', async () => {
    vi.mocked(fetchSecurityAudit).mockResolvedValue({
      events: [{
        id: 1,
        timestamp: new Date(2026, 7, 29, 17, 35, 47).getTime(),
        category: 'command',
        action: 'execute',
        decision: 'approved',
        result: 'failed',
        risk: 'normal',
        summary: '命令已通过安全检查',
        target: 'printf test && mv /tmp/test.csv /tmp/final.csv',
        details: { authorization: 'approved', exit_code: 7, agent_label: '商业分析师', approval_scope: 'turn' },
      }],
      total: 1,
      loaded: 1,
      next_cursor: null,
    });
    await act(async () => {
      root.render(
        <SecurityProtectionSection
          token="gateway-token"
          apiBase="http://127.0.0.1:8900"
          isEnglish={false}
        />,
      );
    });

    await openAudit();

    const record = container.querySelector<HTMLElement>('[data-audit-record]');
    expect(record?.tagName).toBe('DIV');
    expect(record?.querySelector('details > summary')).not.toBeNull();
    expect(record?.textContent).toContain('命令与系统操作');
    expect(record?.textContent).toContain('执行命令');
    expect(record?.textContent).toContain('printf test && mv /tmp/test.csv /tmp/final.csv');
    expect(record?.textContent).toContain('失败');
    expect(record?.textContent).toContain('用户已批准');
    expect(record?.textContent).toContain('商业分析师');
    expect(record?.querySelector('time')?.textContent).toContain('17:35:47');
    expect(record?.querySelector('button')).toBeNull();
    expect(record?.querySelector('summary')?.getAttribute('aria-label')).toContain('展开详情');
    expect(record?.querySelector('dl')).toBeNull();
    await act(async () => {
      const details = record?.querySelector('details');
      if (details) {
        details.open = true;
        details.dispatchEvent(new Event('toggle'));
      }
    });
    expect(record?.querySelector('dl')?.textContent).toContain('退出码7');
    expect(record?.textContent).toContain('本轮同规则、同类操作');
    expect(record?.querySelector('[data-audit-full-target]')?.textContent).toBe('printf test && mv /tmp/test.csv /tmp/final.csv');
  });

  it('includes the security outcome and reason in blocked audit records', async () => {
    vi.mocked(fetchSecurityAudit).mockResolvedValue({
      events: [{
        id: 2,
        timestamp: Date.now(),
        category: 'network',
        action: 'connect',
        decision: 'block',
        result: 'blocked',
        risk: 'high',
        summary: '网络目标命中拒绝域名',
        target: 'https://news.baidu.com/',
        details: {},
      }],
      total: 1,
      loaded: 1,
      next_cursor: null,
    });
    await act(async () => {
      root.render(
        <SecurityProtectionSection
          token="gateway-token"
          apiBase="http://127.0.0.1:8900"
          isEnglish={false}
        />,
      );
    });

    await openAudit();

    const record = container.querySelector('[data-audit-record]');
    expect(record?.textContent).toContain('联网与数据流转');
    expect(record?.textContent).toContain('访问网络');
    expect(record?.textContent).toContain('高风险');
    expect(record?.textContent).toContain('https://news.baidu.com/');
    expect(record?.textContent).toContain('原因：网络目标命中拒绝域名');
    expect(record?.textContent).toContain('已阻止');
  });

  it('labels gateway-generated security setting records without treating them as file operations', async () => {
    vi.mocked(fetchSecurityAudit).mockResolvedValue({
      events: [{
        id: 3,
        timestamp: Date.now(),
        category: 'settings',
        action: 'clear_audit',
        decision: 'allow',
        result: 'succeeded',
        risk: 'normal',
        summary: '安全审计记录已由用户清空',
        target: null,
        details: { deleted_count: 12 },
      }],
      total: 1,
      loaded: 1,
      next_cursor: null,
    });
    await act(async () => {
      root.render(
        <SecurityProtectionSection
          token="gateway-token"
          apiBase="http://127.0.0.1:8900"
          isEnglish={false}
        />,
      );
    });

    await openAudit();

    const record = container.querySelector('[data-audit-record]');
    expect(record?.textContent).toContain('安全设置');
    expect(record?.textContent).toContain('清空审计记录');
    expect(record?.textContent).toContain('安全审计记录已由用户清空');
    expect(record?.textContent).not.toContain('文件操作');
  });

  it('replaces the current page instead of accumulating audit row DOM', async () => {
    vi.mocked(fetchSecurityAudit)
      .mockResolvedValueOnce({
        events: [{
          id: 20,
          timestamp: Date.now(),
          category: 'command',
          action: 'execute',
          decision: 'allow',
          result: 'succeeded',
          risk: 'normal',
          summary: 'first page command',
          target: 'echo FIRST_PAGE',
          details: {},
        }],
        total: 101,
        loaded: 1,
        next_cursor: 20,
      })
      .mockResolvedValueOnce({
        events: [{
          id: 19,
          timestamp: Date.now() - 1,
          category: 'command',
          action: 'execute',
          decision: 'allow',
          result: 'succeeded',
          risk: 'normal',
          summary: 'second page command',
          target: 'echo SECOND_PAGE',
          details: {},
        }],
        total: null,
        loaded: 1,
        next_cursor: null,
      });
    await act(async () => {
      root.render(
        <SecurityProtectionSection
          token="gateway-token"
          apiBase="http://127.0.0.1:8900"
          isEnglish={false}
        />,
      );
    });

    await openAudit();
    const nextPage = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('下一页'));
    await act(async () => nextPage?.click());

    expect(container.querySelectorAll('[data-audit-record]')).toHaveLength(1);
    expect(container.textContent).not.toContain('FIRST_PAGE');
    expect(container.textContent).toContain('SECOND_PAGE');
    expect(container.textContent).toContain('第 2 页');
    expect(vi.mocked(fetchSecurityAudit).mock.calls[1]?.[2]).toMatchObject({
      cursor: 20,
      includeTotal: false,
    });
  });
});
