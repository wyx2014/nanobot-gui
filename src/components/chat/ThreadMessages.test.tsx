import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@/types';

vi.mock('./MessageBubble', () => ({
  default: ({ message }: { message: Message }) => (
    <div data-testid="message-bubble">
      {typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}
    </div>
  ),
}));

vi.mock('./TaskNarrativeTimeline', () => ({
  default: ({ turnStatus }: { turnStatus?: string }) => (
    <div data-testid="activity-timeline" data-turn-status={turnStatus ?? ''} />
  ),
}));

import ThreadMessages from './ThreadMessages';

let container: HTMLDivElement;
let root: Root;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function message(id: string, content: string): Message {
  return {
    id,
    role: 'assistant',
    content,
    timestamp: Date.now(),
  };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ThreadMessages layout', () => {
  it('renders variable-height chat rows in normal document flow', () => {
    act(() => root.render(
      <ThreadMessages
        messages={[
          message('short', '短回复'),
          message('long', '较长回复'.repeat(200)),
        ]}
      />,
    ));

    const thread = container.querySelector<HTMLElement>('[data-thread-messages]');
    const rows = [...container.querySelectorAll<HTMLElement>('[data-thread-unit]')];

    expect(thread?.className).toContain('flex-col');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.className).not.toContain('absolute');
      expect(row.style.transform).toBe('');
    }
  });

  it('removes the previous conversation content synchronously on replacement', () => {
    act(() => root.render(
      <ThreadMessages messages={[message('session-a', '旧会话内容')]} />,
    ));
    expect(container.textContent).toContain('旧会话内容');

    act(() => root.render(
      <ThreadMessages messages={[message('session-b', '新会话内容')]} />,
    ));

    expect(container.textContent).toContain('新会话内容');
    expect(container.textContent).not.toContain('旧会话内容');
  });

  it('uses compact spacing between completed activity and the answer body', () => {
    act(() => root.render(
      <ThreadMessages
        messages={[
          {
            id: 'reasoning',
            role: 'assistant',
            content: '',
            thinking: '已完成分析',
            reasoningStreaming: false,
            timestamp: Date.now(),
          },
          message('answer', '---\n\n# 报告'),
        ]}
      />,
    ));

    const rows = [...container.querySelectorAll<HTMLElement>('[data-thread-unit]')];
    expect(rows).toHaveLength(2);
    expect(rows[1].className).toContain('mt-3');
    expect(rows[1].className).not.toContain('mt-4');
  });

  it('renders a late terminal plan in ToolStep before the final answer', () => {
    act(() => root.render(
      <ThreadMessages
        messages={[
          message('answer', '最终报告'),
          {
            id: 'terminal-plan',
            role: 'tool',
            kind: 'trace',
            content: '',
            timestamp: Date.now(),
            agentUI: {
              kind: 'task_progress',
              status: 'failed',
              active_step_ids: ['team-lead'],
              current_step_id: 'team-lead',
              steps: [
                { id: 'team-lead', title: '主笔交叉质证与汇总', status: 'running' },
              ],
            },
          },
        ]}
      />,
    ));

    expect(
      [...container.querySelectorAll('[data-testid]')]
        .map((node) => node.getAttribute('data-testid')),
    ).toEqual(['activity-timeline', 'message-bubble']);
  });

  it('applies the authoritative latest Turn status only to the latest user turn', () => {
    act(() => root.render(
      <ThreadMessages
        latestTurnStatus="completed"
        messages={[
          { id: 'user-1', role: 'user', content: '旧任务', timestamp: 1 },
          {
            id: 'activity-1',
            role: 'tool',
            kind: 'trace',
            content: '',
            timestamp: 2,
            traces: ['旧任务工具步骤'],
          },
          { ...message('answer-1', '旧任务结果'), timestamp: 3 },
          { id: 'user-2', role: 'user', content: '最新任务', timestamp: 4 },
          {
            id: 'activity-2',
            role: 'tool',
            kind: 'trace',
            content: '',
            timestamp: 5,
            traces: ['最新任务工具步骤'],
          },
          { ...message('answer-2', '最新任务结果'), timestamp: 6 },
        ]}
      />,
    ));

    const timelines = [...container.querySelectorAll<HTMLElement>('[data-testid="activity-timeline"]')];
    expect(timelines).toHaveLength(2);
    expect(timelines[0].dataset.turnStatus).toBe('');
    expect(timelines[1].dataset.turnStatus).toBe('completed');
  });
});
