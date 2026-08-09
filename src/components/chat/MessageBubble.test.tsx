import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import MessageBubble, { formatAssistantCompletedAt } from './MessageBubble';

let container: HTMLDivElement;
let root: Root;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function assistantMessage(completedAt: number): Message {
  return {
    id: 'assistant-answer',
    role: 'assistant',
    content: '这是模型回复。',
    timestamp: completedAt - 2_000,
    completedAt,
  };
}

describe('MessageBubble assistant reply actions', () => {
  it('formats completion time for today, this week, and earlier dates', () => {
    const now = new Date(2026, 6, 29, 20, 0).getTime();

    expect(formatAssistantCompletedAt(new Date(2026, 6, 29, 10, 32).getTime(), now))
      .toBe('10:32');
    expect(formatAssistantCompletedAt(new Date(2026, 6, 28, 17, 39).getTime(), now))
      .toBe('星期二17:39');
    expect(formatAssistantCompletedAt(new Date(2026, 6, 22, 14, 16).getTime(), now))
      .toBe('7月22日 14:16');
  });

  it('keeps an earlier reply action bar hidden until its reply is hovered', () => {
    const completedAt = new Date(2026, 6, 29, 10, 32).getTime();
    act(() => root.render(
      <MessageBubble message={assistantMessage(completedAt)} isLastAssistantReply={false} />,
    ));

    const actions = container.querySelector<HTMLElement>('[data-testid="assistant-reply-actions"]');
    expect(actions?.classList.contains('opacity-0')).toBe(true);
    expect(actions?.classList.contains('group-hover/assistant:opacity-100')).toBe(true);
    expect(actions?.textContent).toContain('10:32');
  });

  it('shows the last assistant reply action bar by default', () => {
    const completedAt = new Date(2026, 6, 29, 10, 32).getTime();
    act(() => root.render(
      <MessageBubble message={assistantMessage(completedAt)} isLastAssistantReply />,
    ));

    const actions = container.querySelector<HTMLElement>('[data-testid="assistant-reply-actions"]');
    expect(actions?.classList.contains('opacity-100')).toBe(true);
    expect(actions?.classList.contains('opacity-0')).toBe(false);
    expect(actions?.querySelector('[aria-label="Copy reply"]')).not.toBeNull();
  });

  it('keeps restored conversation text static while only a live reply may animate', () => {
    const completedAt = new Date(2026, 6, 29, 10, 32).getTime();
    act(() => root.render(
      <MessageBubble message={assistantMessage(completedAt)} />,
    ));

    const restored = container.querySelector<HTMLElement>('[data-message-bubble]');
    expect(restored?.className).not.toContain('animate-in');
    expect(restored?.getAttribute('data-streaming')).toBe('false');

    act(() => root.render(
      <MessageBubble
        message={{ ...assistantMessage(completedAt), isStreaming: true }}
      />,
    ));

    const live = container.querySelector<HTMLElement>('[data-message-bubble]');
    expect(live?.className).toContain('motion-safe:animate-in');
    expect(live?.getAttribute('data-streaming')).toBe('true');
  });
});

describe('MessageBubble user context badges', () => {
  it('collapses multiple MCP connectors into one badge and an overflow count', () => {
    const message: Message = {
      id: 'user-with-mcp',
      role: 'user',
      content: '帮我分析下 长江电力',
      timestamp: Date.now(),
      mcpPresets: [
        { name: 'ifind-stock', display_name: '同花顺 iFinD 股票 MCP' },
        { name: 'ifind-news', display_name: '同花顺 iFinD 新闻 MCP' },
        { name: 'juyuan', display_name: '聚源金融数据 MCP' },
      ],
    };

    act(() => root.render(<MessageBubble message={message} />));

    const badges = container.querySelectorAll('[data-mcp-preset-chip]');
    const overflow = container.querySelector<HTMLElement>('[data-mcp-preset-overflow]');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toContain('同花顺 iFinD 股票 MCP');
    expect(overflow?.textContent).toBe('+2');
    expect(overflow?.title).toContain('同花顺 iFinD 新闻 MCP');
    expect(overflow?.title).toContain('聚源金融数据 MCP');
    expect(container.textContent).not.toContain('同花顺 iFinD 新闻 MCP');
  });
});
