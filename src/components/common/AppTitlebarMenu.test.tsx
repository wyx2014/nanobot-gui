import type { ComponentProps, PropsWithChildren } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLanguage } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: PropsWithChildren) => <div data-menu-group>{children}</div>,
  DropdownMenuTrigger: ({ children, ...props }: ComponentProps<'button'>) => (
    <button type="button" {...props}>{children}</button>
  ),
  DropdownMenuContent: ({
    children,
    align: _align,
    sideOffset: _sideOffset,
    ...props
  }: PropsWithChildren<{ align?: string; sideOffset?: number; className?: string }>) => (
    <div {...props}>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    ...props
  }: PropsWithChildren<{ onSelect?: () => void; className?: string }>) => (
    <button type="button" onClick={onSelect} {...props}>{children}</button>
  ),
  DropdownMenuSeparator: (props: ComponentProps<'hr'>) => <hr {...props} />,
}));

import AppTitlebarMenu from './AppTitlebarMenu';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function buttonWithText(text: string): HTMLButtonElement {
  const button = Array.from(container?.querySelectorAll('button') ?? [])
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

beforeEach(() => {
  setLanguage('zh-CN');
  useSettingsStore.setState({
    language: 'zh-CN',
    viewMode: 'chat',
    activeSystemTab: 'general',
  });
  vi.mocked(window.ipc.invoke).mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<AppTitlebarMenu />));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  setLanguage('system');
});

describe('AppTitlebarMenu', () => {
  it('renders the compact Edit, Window and Help menus in the requested order', () => {
    const menu = container?.querySelector('[data-app-titlebar-menu]');
    const topLevelLabels = Array.from(menu?.children ?? [])
      .map((group) => group.querySelector('button')?.textContent);

    expect(topLevelLabels).toEqual(['编辑(E)', '窗口(W)', '帮助(H)']);
  });

  it('restores the text input before executing an Electron edit command', async () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    act(() => buttonWithText('复制').click());
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));

    expect(document.activeElement).toBe(input);
    expect(window.ipc.invoke).toHaveBeenCalledWith('window:performEditCommand', 'copy');
    input.remove();
  });

  it('connects window and help actions to their real destinations', () => {
    act(() => buttonWithText('关闭窗口').click());
    expect(window.ipc.invoke).toHaveBeenCalledWith('window:close');

    act(() => buttonWithText('打开日志目录').click());
    expect(window.ipc.invoke).toHaveBeenCalledWith('window:openLogsDirectory');

    act(() => buttonWithText('使用文档').click());
    expect(useSettingsStore.getState()).toMatchObject({
      viewMode: 'settings',
      activeSystemTab: 'help',
      helpManualOpen: true,
    });

    act(() => buttonWithText('意见反馈').click());
    expect(useSettingsStore.getState()).toMatchObject({
      viewMode: 'settings',
      activeSystemTab: 'feedback',
    });
  });
});
