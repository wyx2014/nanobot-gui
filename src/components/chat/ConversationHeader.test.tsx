import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLanguage } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import ConversationHeader from './ConversationHeader';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderHeader(onScrollToBottom = vi.fn()) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <ConversationHeader
        conversationTitle="这是一个超过十五个字符的会话标题用于测试"
        onScrollToBottom={onScrollToBottom}
      />,
    );
  });
  return { view: container, onScrollToBottom };
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
  it('left-aligns and truncates the conversation title after 15 characters', () => {
    const { view } = renderHeader();
    const summaryToggle = view.querySelector<HTMLButtonElement>('[data-pinned-summary-toggle]');
    const title = view.querySelector<HTMLElement>('[data-conversation-header] span[title]');

    expect(view.querySelector('[data-conversation-header]')).not.toBeNull();
    expect(title?.textContent).toBe('这是一个超过十五个字符的会话标...');
    expect(title?.getAttribute('title')).toBe('这是一个超过十五个字符的会话标题用于测试');
    expect(view.querySelector('[data-conversation-header-open-location]')).toBeNull();
    expect(view.querySelector('[data-conversation-header-more]')).toBeNull();
    expect(summaryToggle?.querySelector('svg')).not.toBeNull();
    expect(summaryToggle?.textContent).toBe('');
    expect(summaryToggle?.getAttribute('title')).toBe('置顶摘要');
    expect(summaryToggle?.getAttribute('aria-expanded')).toBe('false');

    act(() => summaryToggle?.click());

    expect(useSettingsStore.getState().rightPanelCollapsed).toBe(false);
    expect(summaryToggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('connects the two layout icons to real conversation actions', () => {
    const onScrollToBottom = vi.fn();
    const { view } = renderHeader(onScrollToBottom);

    act(() => view.querySelector<HTMLButtonElement>('[data-conversation-header-scroll-bottom]')?.click());
    expect(onScrollToBottom).toHaveBeenCalledOnce();

    act(() => view.querySelector<HTMLButtonElement>('[data-conversation-header-sidebar]')?.click());
    expect(useSettingsStore.getState().sidebarCollapsed).toBe(true);
  });
});
