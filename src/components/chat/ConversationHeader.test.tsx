import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLanguage } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import ConversationHeader from './ConversationHeader';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderHeader({
  onOpenWorkspaceFolder = vi.fn(),
  searchOpen = false,
  searchQuery = '',
  searchMatchCount = 0,
  activeSearchMatchIndex = 0,
  onOpenSearch = vi.fn(),
  onCloseSearch = vi.fn(),
  onSearchQueryChange = vi.fn(),
  onPreviousSearchMatch = vi.fn(),
  onNextSearchMatch = vi.fn(),
}: Partial<Parameters<typeof ConversationHeader>[0]> = {}) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider>
        <ConversationHeader
          conversationTitle="这是一个超过十五个字符的会话标题用于测试"
          onOpenWorkspaceFolder={onOpenWorkspaceFolder}
          searchOpen={searchOpen}
          searchQuery={searchQuery}
          searchMatchCount={searchMatchCount}
          activeSearchMatchIndex={activeSearchMatchIndex}
          onOpenSearch={onOpenSearch}
          onCloseSearch={onCloseSearch}
          onSearchQueryChange={onSearchQueryChange}
          onPreviousSearchMatch={onPreviousSearchMatch}
          onNextSearchMatch={onNextSearchMatch}
        />
      </TooltipProvider>,
    );
  });
  return {
    view: container,
    onOpenWorkspaceFolder,
    onOpenSearch,
    onCloseSearch,
    onSearchQueryChange,
    onPreviousSearchMatch,
    onNextSearchMatch,
  };
}

beforeEach(() => {
  setLanguage('zh-CN');
  useSettingsStore.setState({
    rightPanelCollapsed: true,
    sidebarCollapsed: false,
    language: 'zh-CN',
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  setLanguage('system');
});

describe('ConversationHeader', () => {
  it('left-aligns and renders the complete conversation title', () => {
    const { view } = renderHeader();
    const summaryToggle = view.querySelector<HTMLButtonElement>('[data-pinned-summary-toggle]');
    const title = view.querySelector<HTMLElement>('[data-conversation-header] span[title]');

    expect(view.querySelector('[data-conversation-header]')).not.toBeNull();
    expect(view.querySelector('[data-conversation-header]')?.classList)
      .toContain('conversation-header-titlebar-inset');
    expect(view.querySelector('[data-conversation-header]')?.classList)
      .not.toContain('window-titlebar-drag');
    expect(title?.textContent).toBe('这是一个超过十五个字符的会话标题用于测试');
    expect(title?.getAttribute('title')).toBe('这是一个超过十五个字符的会话标题用于测试');
    expect(view.querySelector('[data-conversation-header-open-location]')).toBeNull();
    expect(view.querySelector('[data-conversation-header-more]')).toBeNull();
    expect(summaryToggle?.querySelector('svg')).not.toBeNull();
    expect(summaryToggle?.textContent).toBe('');
    expect(summaryToggle?.getAttribute('aria-label')).toBe('置顶摘要');
    expect(summaryToggle?.getAttribute('aria-expanded')).toBe('false');

    act(() => summaryToggle?.click());

    expect(useSettingsStore.getState().rightPanelCollapsed).toBe(false);
    expect(summaryToggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('connects the workspace-folder icon to the conversation action', () => {
    const onOpenWorkspaceFolder = vi.fn();
    const { view } = renderHeader({ onOpenWorkspaceFolder });

    const button = view.querySelector<HTMLButtonElement>('[data-conversation-header-open-workspace]');
    expect(button?.getAttribute('aria-label')).toBe('打开工作空间目录');
    act(() => button?.click());
    expect(onOpenWorkspaceFolder).toHaveBeenCalledOnce();
  });

  it('places the conversation search button immediately before the pinned summary', () => {
    const onOpenSearch = vi.fn();
    const { view } = renderHeader({ onOpenSearch });
    const searchToggle = view.querySelector<HTMLButtonElement>('[data-conversation-search-toggle]');
    const summaryToggle = view.querySelector<HTMLButtonElement>('[data-pinned-summary-toggle]');

    expect(searchToggle?.getAttribute('aria-label')).toBe('搜索当前会话');
    expect(
      (searchToggle?.compareDocumentPosition(summaryToggle!) ?? 0)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    act(() => searchToggle?.click());
    expect(onOpenSearch).toHaveBeenCalledOnce();
  });

  it('renders the expanded search field with count, navigation, and close actions', async () => {
    const onCloseSearch = vi.fn();
    const onSearchQueryChange = vi.fn();
    const onPreviousSearchMatch = vi.fn();
    const onNextSearchMatch = vi.fn();
    const { view } = renderHeader({
      searchOpen: true,
      searchQuery: '数字',
      searchMatchCount: 2,
      activeSearchMatchIndex: 0,
      onCloseSearch,
      onSearchQueryChange,
      onPreviousSearchMatch,
      onNextSearchMatch,
    });

    const input = view.querySelector<HTMLInputElement>('[data-conversation-search-input]');
    const count = view.querySelector('[data-conversation-search-count]');
    expect(input?.value).toBe('数字');
    expect(count?.textContent).toBe('1/2');
    await act(async () => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    }));
    expect(document.activeElement).toBe(input);

    act(() => input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onNextSearchMatch).toHaveBeenCalledOnce();
    act(() => input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })));
    expect(onPreviousSearchMatch).toHaveBeenCalledOnce();
    act(() => input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onCloseSearch).toHaveBeenCalledOnce();
  });

  it('opens search with the platform find shortcut', () => {
    const onOpenSearch = vi.fn();
    renderHeader({ onOpenSearch });

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })));

    expect(onOpenSearch).toHaveBeenCalledOnce();
  });
});
