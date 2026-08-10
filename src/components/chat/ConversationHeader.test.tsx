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

function renderHeader(onOpenTerminal = vi.fn()) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider>
        <ConversationHeader
          conversationTitle="这是一个超过十五个字符的会话标题用于测试"
          onOpenTerminal={onOpenTerminal}
        />
      </TooltipProvider>,
    );
  });
  return { view: container, onOpenTerminal };
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
    expect(view.querySelector('[data-conversation-header]')?.classList)
      .toContain('conversation-header-titlebar-inset');
    expect(view.querySelector('[data-conversation-header]')?.classList)
      .not.toContain('window-titlebar-drag');
    expect(title?.textContent).toBe('这是一个超过十五个字符的会话标...');
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

  it('connects the open-terminal icon to the real conversation action', () => {
    const onOpenTerminal = vi.fn();
    const { view } = renderHeader(onOpenTerminal);

    act(() => view.querySelector<HTMLButtonElement>('[data-conversation-header-open-terminal]')?.click());
    expect(onOpenTerminal).toHaveBeenCalledOnce();
  });
});
