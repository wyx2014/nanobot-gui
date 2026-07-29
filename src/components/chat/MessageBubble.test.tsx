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
    expect(actions?.querySelector('[aria-label="Regenerate"]')).not.toBeNull();
  });
});
