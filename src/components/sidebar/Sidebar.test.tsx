import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Sidebar from './Sidebar';
import { useChatStore } from '@/stores/chatStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { isWindows } from '@/utils/platform';
import { usePromptHubStore } from '@/stores/promptHubStore';

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
  useSettingsStore.setState({ viewMode: 'chat', guideShown: true, guideOpen: false });
  useScheduleStore.setState({ tasks: {} });
  usePromptHubStore.setState({
    token: null,
    user: null,
    isLoggingIn: false,
    loginOpen: false,
    error: null,
  });
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
    const backdrop = document.body.querySelector<HTMLElement>('[data-testid="conversation-search-backdrop"]');
    expect(dialog).not.toBeNull();
    expect(backdrop?.classList.contains(isWindows() ? 'top-10' : 'top-0')).toBe(true);
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

describe('Sidebar workspace creation', () => {
  it('shows a newly created blank workspace before the first message is sent', async () => {
    const view = renderSidebar();
    const addWorkspaceButton = view.querySelector<HTMLButtonElement>('button[aria-label="新建工作空间"]');

    expect(addWorkspaceButton).not.toBeNull();
    act(() => addWorkspaceButton?.click());

    const createBlankButton = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('新建空白工作空间'));
    expect(createBlankButton).not.toBeUndefined();
    act(() => createBlankButton?.click());

    const nameInput = document.body.querySelector<HTMLInputElement>('input[placeholder="保持简短且易识别"]');
    expect(nameInput).not.toBeNull();
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(nameInput, '季度研究');
      nameInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const saveButton = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '保存');
    expect(saveButton).not.toBeUndefined();
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const createdPath = '/Users/testuser/Documents/TPACowork Projects/季度研究';
    expect(useWorkspaceStore.getState().currentPath).toBe(createdPath);
    expect(useWorkspaceStore.getState().recentPaths[0]).toBe(createdPath);
    expect(view.textContent).toContain('季度研究');
    expect(useChatStore.getState().activeConversationId).toBeNull();
  });
});

describe('Sidebar help', () => {
  it('reopens the first-run guide without resetting its completion flag', () => {
    const view = renderSidebar();
    const helpButton = view.querySelector<HTMLButtonElement>('button[title="帮助"]');

    expect(helpButton).not.toBeNull();
    act(() => helpButton?.click());

    expect(useSettingsStore.getState().guideOpen).toBe(true);
    expect(useSettingsStore.getState().guideShown).toBe(true);
  });
});

describe('Sidebar toolbox', () => {
  it('opens the toolbox on expert teams by default', () => {
    useSettingsStore.setState({ activeToolboxTab: 'mcp', toolboxSearchQuery: '旧搜索' });
    const view = renderSidebar();
    const toolboxButton = [...view.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '工具箱');

    expect(toolboxButton).not.toBeUndefined();
    act(() => toolboxButton?.click());

    expect(useSettingsStore.getState()).toMatchObject({
      viewMode: 'toolbox',
      activeToolboxTab: 'expert-teams',
      toolboxSearchQuery: '',
    });
  });
});

describe('PromptHub login', () => {
  it('keeps the deployment server address out of the user-facing dialog', () => {
    usePromptHubStore.setState({ loginOpen: true });
    const view = renderSidebar();
    const dialog = view.querySelector<HTMLElement>('[data-testid="prompthub-login-dialog"]');

    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('用户名');
    expect(dialog?.textContent).toContain('密码');
    expect(dialog?.textContent).not.toContain('服务器地址');
    expect(dialog?.querySelector('input[type="url"]')).toBeNull();
  });
});
