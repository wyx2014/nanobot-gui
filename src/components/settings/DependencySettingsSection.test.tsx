import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DependencySettingsSection from './DependencySettingsSection';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn(), check: vi.fn() }));
vi.mock('@/core/api', () => ({ fetchPackageSources: mocks.fetch, savePackageSources: mocks.save, checkPackageSources: mocks.check }));
const original = {
  enabled: false, workspace_python: true,
  npm_registry: 'https://npm.example/', pypi_index_url: 'https://pip.example/simple/',
  python_path: 'C:\\TPCowork\\resources\\python\\python.exe', npm_path: '', node_path: '', uv_path: '',
};
let container: HTMLDivElement;
let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const button = (text: string) => [...container.querySelectorAll('button')].find(node => node.textContent === text)!;

beforeEach(async () => {
  mocks.fetch.mockResolvedValue(original);
  mocks.save.mockImplementation(async (_token, values) => ({ ...original, ...values }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<DependencySettingsSection token="token" apiBase="http://127.0.0.1:8900" isEnglish={false} />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks(); });

describe('dependency settings', () => {
  it('saves the company preset to the explicit gateway and retains workspace isolation', async () => {
    expect(mocks.fetch).toHaveBeenCalledWith('token', 'http://127.0.0.1:8900');
    expect(container.textContent).toContain('未找到，请检查软件运行环境');
    act(() => button('填入公司内网源').click());
    expect(button('检查已保存配置').disabled).toBe(true);
    await act(async () => button('保存').click());
    expect(mocks.save).toHaveBeenCalledWith('token', {
      enabled: true, workspace_python: true,
      npm_registry: 'http://10.94.211.66/repository/npm_mirror/',
      pypi_index_url: 'http://10.94.211.66/repository/officialPypi/simple/',
    }, 'http://127.0.0.1:8900');
    expect(button('保存').disabled).toBe(true);
    expect(button('检查已保存配置').disabled).toBe(false);
  });

  it('preserves an unsaved draft after a save failure', async () => {
    mocks.save.mockRejectedValue(new Error('Gateway unavailable'));
    act(() => button('填入公司内网源').click());
    await act(async () => button('保存').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Gateway unavailable');
    expect(container.querySelector('input')?.value).toContain('npm_mirror');
    expect(button('保存').disabled).toBe(false);
  });

  it('can turn off package overrides without disabling the workspace Python environment', async () => {
    act(() => button('填入公司内网源').click());
    await act(async () => button('保存').click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="使用指定包源"]')!.click());
    await act(async () => button('保存').click());
    expect(mocks.save).toHaveBeenLastCalledWith('token', expect.objectContaining({ enabled: false, workspace_python: true }), 'http://127.0.0.1:8900');
  });

  it('shows actionable check failures and a saved-but-restart-needed state', async () => {
    mocks.save.mockImplementation(async (_token, values) => ({ ...original, ...values, requires_restart: true }));
    act(() => button('填入公司内网源').click());
    await act(async () => button('保存').click());
    expect(container.textContent).toContain('现有 MCP 需要重启');
    mocks.check.mockResolvedValue({ ...original, enabled: true, checks: [{ name: 'pip', ok: false, code: 'unreachable', message: 'Repository unavailable' }] });
    await act(async () => button('检查已保存配置').click());
    expect(container.textContent).toContain('unreachable: Repository unavailable');
  });

  it('reports disconnected MCP servers without losing successfully saved settings', async () => {
    mocks.save.mockImplementation(async (_token, values) => ({ ...original, ...values, requires_restart: false, mcp_reload_error: 'demo did not connect' }));
    act(() => button('填入公司内网源').click());
    await act(async () => button('保存').click());
    expect(container.textContent).toContain('已保存，新命令立即生效。部分 MCP 尚未连接');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('demo did not connect');
    expect(button('保存').disabled).toBe(true);
  });
});
