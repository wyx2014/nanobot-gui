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

  beforeEach(() => {
    container = document.createElement('div');
    root = createRoot(container);
    const policy: SecurityPolicyPayload = {
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
      components: {},
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

    expect(container.textContent).toContain('应用安全防护已开启');
    expect(container.textContent).not.toContain('Full Access');
    expect(container.textContent).toContain('始终开启');
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
    expect(container.textContent).toContain('阻断所有网络访问');
    expect(container.textContent).toContain('允许域名');
    expect(container.textContent).toContain('拒绝域名');
    expect(container.textContent).toContain('不能替代操作系统防火墙');
  });

  it('uses only file, command, and network as audit center types', async () => {
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

    expect(container.textContent).toContain('文件安全');
    expect(container.textContent).toContain('命令安全');
    expect(container.textContent).toContain('网络安全');
    expect(container.textContent).not.toContain('MCP');
    expect(container.textContent).not.toContain('设置');
  });

  it('renders audit records as non-interactive text and time columns', async () => {
    vi.mocked(fetchSecurityAudit).mockResolvedValue({
      events: [{
        id: 1,
        timestamp: new Date(2026, 7, 29, 17, 35, 47).getTime(),
        category: 'command',
        action: 'execute',
        decision: 'allow',
        result: 'succeeded',
        risk: 'normal',
        summary: '命令已通过安全检查',
        target: 'printf test && mv /tmp/test.csv /tmp/final.csv',
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

    const auditCenter = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('审计中心'));
    await act(async () => {
      auditCenter?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    const record = container.querySelector<HTMLElement>('[data-audit-record]');
    expect(record?.tagName).toBe('DIV');
    expect(record?.children).toHaveLength(2);
    expect(record?.textContent).toContain('命令安全');
    expect(record?.textContent).toContain('执行命令');
    expect(record?.textContent).toContain('printf test && mv /tmp/test.csv /tmp/final.csv');
    expect(record?.textContent).toContain('已完成');
    expect(record?.querySelector('time')?.textContent).toContain('17:35:47');
    expect(record?.querySelector('button')).toBeNull();
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

    const auditCenter = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('审计中心'));
    await act(async () => {
      auditCenter?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

    const record = container.querySelector('[data-audit-record]');
    expect(record?.textContent).toContain('网络安全');
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

    const auditCenter = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('审计中心'));
    await act(async () => {
      auditCenter?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });

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

    const auditCenter = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('审计中心'));
    await act(async () => {
      auditCenter?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    });
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
