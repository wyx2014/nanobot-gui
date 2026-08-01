import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Sidebar from './Sidebar';
import { useChatStore } from '@/stores/chatStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderSidebar() {
  container = document.createElement('div');
  container.style.height = '800px';
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Sidebar />));
  return container;
}

function openSearchDialog() {
  const searchButton = container?.querySelector<HTMLButtonElement>('[aria-keyshortcuts]');
  expect(searchButton).not.toBeNull();
  act(() => searchButton?.click());
  return document.body.querySelector<HTMLElement>('[data-testid="conversation-search-dialog"]');
}

beforeEach(() => {
  useSettingsStore.getState().setLanguage('zh-CN');
  useSettingsStore.setState({ viewMode: 'chat' });
  useScheduleStore.setState({ tasks: {} });
  useWorkspaceStore.setState({
    currentPath: null,
    recentPaths: ['/Users/test/nanobot-gui'],
    projects: [],
    projectNames: {},
    projectSkillBindings: {},
  });
  useChatStore.setState({
    activeConversationId: 'alpha',
    conversations: {
      alpha: {
        id: 'alpha',
        title: 'Alpha 方案',
        messages: [{ id: 'alpha-message', role: 'user', content: '检查发布计划', timestamp: 1 }],
        createdAt: 1,
        updatedAt: 2,
        status: 'idle',
        hasHistory: true,
        workspacePath: '/Users/test/nanobot-gui',
      },
      beta: {
        id: 'beta',
        title: 'Beta 报告',
        messages: [{ id: 'beta-message', role: 'user', content: '整理华东销售数据', timestamp: 2 }],
        createdAt: 2,
        updatedAt: 3,
        status: 'idle',
        hasHistory: true,
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe('Sidebar conversation search', () => {
  it('opens a command dialog and keeps the project path out of the sidebar', () => {
    const view = renderSidebar();

    expect(view.textContent).toContain('TPACowork');
    expect(view.textContent).toContain('nanobot-gui');
    expect(view.textContent).not.toContain('/Users/test/nanobot-gui');
    expect(view.querySelector('input[placeholder="搜索聊天"]')).toBeNull();

    const dialog = openSearchDialog();
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('input[placeholder="搜索聊天"]')).not.toBeNull();
    expect(dialog?.textContent).toContain('Alpha 方案');
    expect(dialog?.textContent).toContain('Beta 报告');
  });

  it('filters message content and opens the selected conversation with Enter', () => {
    renderSidebar();
    const dialog = openSearchDialog();
    const input = dialog?.querySelector<HTMLInputElement>('input[placeholder="搜索聊天"]');
    expect(input).not.toBeNull();

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, '华东销售');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(dialog?.textContent).not.toContain('Alpha 方案');
    expect(dialog?.textContent).toContain('Beta 报告');

    act(() => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(useChatStore.getState().activeConversationId).toBe('beta');
    expect(document.body.querySelector('[data-testid="conversation-search-dialog"]')).toBeNull();
  });
});
