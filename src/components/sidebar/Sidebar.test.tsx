import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Sidebar from './Sidebar';
import { useChatStore } from '@/stores/chatStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
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

function buttonWithText(rootNode: ParentNode, text: string) {
  return [...rootNode.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === text);
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

    expect(view.textContent).toContain('TPCowork');
    expect(view.textContent).toContain('nanobot-gui');
    expect(view.textContent).not.toContain('/Users/test/nanobot-gui');
    expect(view.querySelector('input[placeholder="搜索任务"]')).toBeNull();

    const dialog = openSearchDialog();
    const backdrop = document.body.querySelector<HTMLElement>('[data-testid="conversation-search-backdrop"]');
    expect(dialog).not.toBeNull();
    expect(backdrop?.classList.contains('window-titlebar-safe-top')).toBe(true);
    expect(dialog?.parentElement?.classList.contains('window-modal-viewport')).toBe(true);
    expect(dialog?.parentElement?.classList.contains('items-center')).toBe(true);
    expect(dialog?.classList.contains('max-w-[720px]')).toBe(true);
    expect(dialog?.classList.contains('h-[72vh]')).toBe(true);
    expect(dialog?.querySelector('input[placeholder="搜索任务"]')).not.toBeNull();
    expect(dialog?.textContent).toContain('最近任务');
    expect(dialog?.querySelector('button[aria-label="关闭"]')).not.toBeNull();
    expect(dialog?.querySelector('svg.lucide-folder')).not.toBeNull();
    expect(dialog?.textContent).toContain('Alpha 方案');
    expect(dialog?.textContent).toContain('Beta 报告');
  });

  it('filters message content and opens the selected conversation with Enter', () => {
    renderSidebar();
    const dialog = openSearchDialog();
    const input = dialog?.querySelector<HTMLInputElement>('input[placeholder="搜索任务"]');
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

  it('filters by real conversation status and marks the filter icon while active', () => {
    useChatStore.setState((state) => ({
      conversations: {
        ...state.conversations,
        beta: { ...state.conversations.beta, status: 'running' },
      },
    }));
    renderSidebar();
    const dialog = openSearchDialog();
    const trigger = dialog?.querySelector<HTMLButtonElement>('[data-testid="conversation-filter-trigger"]');

    expect(trigger).not.toBeNull();
    act(() => trigger?.click());
    const menu = dialog?.querySelector<HTMLElement>('[data-testid="conversation-filter-menu"]');
    expect(menu?.textContent).toContain('筛选状态');
    expect(menu?.textContent).toContain('筛选时间');

    act(() => buttonWithText(menu!, '进行中')?.click());

    expect(dialog?.textContent).not.toContain('Alpha 方案');
    expect(dialog?.textContent).toContain('Beta 报告');
    expect(trigger?.querySelector('[data-testid="conversation-filter-active-dot"]')).not.toBeNull();

    act(() => buttonWithText(menu!, '重置筛选条件')?.click());

    expect(dialog?.textContent).toContain('Alpha 方案');
    expect(dialog?.textContent).toContain('Beta 报告');
    expect(trigger?.querySelector('[data-testid="conversation-filter-active-dot"]')).toBeNull();
  });

  it('shows the filter empty state below recent tasks and keeps keyword search independent', () => {
    renderSidebar();
    const dialog = openSearchDialog();
    const trigger = dialog?.querySelector<HTMLButtonElement>('[data-testid="conversation-filter-trigger"]');
    act(() => trigger?.click());
    const menu = dialog?.querySelector<HTMLElement>('[data-testid="conversation-filter-menu"]');

    act(() => buttonWithText(menu!, '失败')?.click());
    expect(dialog?.textContent).toContain('最近任务');
    expect(dialog?.textContent).toContain('没有匹配的任务');

    const input = dialog?.querySelector<HTMLInputElement>('input[placeholder="搜索任务"]');
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, 'Alpha');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(dialog?.textContent).toContain('Alpha 方案');
    expect(dialog?.textContent).not.toContain('Beta 报告');
    expect(trigger?.querySelector('[data-testid="conversation-filter-active-dot"]')).toBeNull();
  });
});

describe('Sidebar homepage conversation filters', () => {
  it('filters workspace and recent conversations from the homepage control', () => {
    useChatStore.setState((state) => ({
      conversations: {
        ...state.conversations,
        beta: { ...state.conversations.beta, status: 'running' },
      },
    }));
    const view = renderSidebar();
    const trigger = view.querySelector<HTMLButtonElement>('[data-testid="sidebar-conversation-filter-trigger"]');

    expect(trigger).not.toBeNull();
    act(() => trigger?.click());
    const menu = view.querySelector<HTMLElement>('[data-testid="sidebar-conversation-filter-menu"]');
    expect(trigger?.parentElement?.previousElementSibling?.getAttribute('aria-label')).toBe('搜索任务');
    expect(menu?.classList.contains('fixed')).toBe(true);
    expect(menu?.classList.contains('w-56')).toBe(true);
    expect(menu?.style.left).toBe('8px');
    expect(menu?.textContent).toContain('筛选状态');
    expect(menu?.textContent).toContain('筛选时间');

    act(() => buttonWithText(menu!, '进行中')?.click());

    expect(view.textContent).not.toContain('Alpha 方案');
    expect(view.textContent).not.toContain('nanobot-gui');
    expect(view.textContent).toContain('Beta 报告');
    expect(trigger?.querySelector('[data-testid="sidebar-conversation-filter-active-dot"]')).not.toBeNull();

    act(() => buttonWithText(menu!, '重置筛选条件')?.click());

    expect(view.textContent).toContain('Alpha 方案');
    expect(view.textContent).toContain('nanobot-gui');
    expect(view.textContent).toContain('Beta 报告');
    expect(trigger?.querySelector('[data-testid="sidebar-conversation-filter-active-dot"]')).toBeNull();
  });

  it('shows no matching tasks below recents without changing search dialog results', () => {
    const view = renderSidebar();
    const trigger = view.querySelector<HTMLButtonElement>('[data-testid="sidebar-conversation-filter-trigger"]');
    act(() => trigger?.click());
    const menu = view.querySelector<HTMLElement>('[data-testid="sidebar-conversation-filter-menu"]');

    act(() => buttonWithText(menu!, '失败')?.click());

    expect(view.textContent).toContain('最近');
    expect(view.textContent).toContain('没有匹配的任务');
    expect(view.textContent).not.toContain('Alpha 方案');
    expect(view.textContent).not.toContain('Beta 报告');

    const dialog = openSearchDialog();
    expect(dialog?.textContent).toContain('Alpha 方案');
    expect(dialog?.textContent).toContain('Beta 报告');
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

    const createdPath = '/Users/testuser/Documents/TPCowork Projects/季度研究';
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

describe('Sidebar hidden diagnostics', () => {
  it('only opens the continuously recorded log panel after five consecutive brand clicks', async () => {
    const view = renderSidebar();
    const brand = view.querySelector<HTMLButtonElement>('[data-testid="sidebar-brand-trigger"]');

    expect(brand).not.toBeNull();
    act(() => {
      for (let click = 0; click < 4; click += 1) brand?.click();
    });
    expect(document.body.querySelector('[data-testid="nanobot-diagnostics-dialog"]')).toBeNull();

    await act(async () => {
      brand?.click();
      await Promise.resolve();
    });

    const dialog = document.body.querySelector<HTMLElement>('[data-testid="nanobot-diagnostics-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('日志从应用启动时就持续记录');
    expect(dialog?.textContent).toContain('复制诊断日志');
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
