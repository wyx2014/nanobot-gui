import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import TaskNarrativeTimeline from './TaskNarrativeTimeline';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

function render(
  messages: Message[],
  options: { isActive?: boolean; turnLatencyMs?: number; hasBodyBelow?: boolean } = {},
) {
  if (!container) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  act(() => root?.render(
    <TaskNarrativeTimeline
      messages={messages}
      isActive={options.isActive ?? true}
      turnLatencyMs={options.turnLatencyMs}
      hasBodyBelow={options.hasBodyBelow}
    />,
  ));
  return container;
}

describe('TaskNarrativeTimeline streaming UI', () => {
  it('shows a live loading state and keeps active steps expanded', () => {
    const view = render([{
      id: 'tool-frame', role: 'tool', kind: 'trace', content: '', timestamp: Date.now(),
      toolEvents: [{ phase: 'start', call_id: 'search-1', name: 'web_search', arguments: { query: '市场规模' } }],
    }]);

    const toggle = view.querySelector<HTMLButtonElement>('button[aria-label="折叠任务步骤"]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.textContent).toContain('进行中');
    expect(view.querySelectorAll('.animate-spin').length).toBeGreaterThanOrEqual(2);
  });

  it('collapses completed steps into a duration summary and can reopen them', () => {
    const view = render([{
      id: 'tool-end', role: 'tool', kind: 'trace', content: '', timestamp: Date.now(),
      toolEvents: [{ phase: 'end', call_id: 'search-1', name: 'web_search', result: '3 results' }],
    }], { isActive: false, turnLatencyMs: 548_000 });

    const toggle = view.querySelector<HTMLButtonElement>('button[aria-label="展开任务步骤"]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.textContent).toContain('已完成 9m8s');
    expect(view.querySelector('[aria-hidden="true"]')).not.toBeNull();

    act(() => toggle?.click());

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.getAttribute('aria-label')).toBe('折叠任务步骤');
  });

  it('treats a failed inner step as completed when a final answer exists', () => {
    const view = render([{
      id: 'tool-error', role: 'tool', kind: 'trace', content: '', timestamp: Date.now(),
      toolEvents: [{ phase: 'error', call_id: 'search-1', name: 'web_search', error: 'temporary failure' }],
    }], { isActive: false, turnLatencyMs: 496_000, hasBodyBelow: true });

    const toggle = view.querySelector<HTMLButtonElement>('button[aria-label="展开任务步骤"]');
    expect(toggle?.textContent).toContain('已完成 8m16s');
    expect(toggle?.textContent).not.toContain('未完成');
    expect(view.querySelector('.text-red-600')).toBeNull();
    expect(view.querySelector('.text-red-500')).toBeNull();
  });

  it('shows unfinished only when an error ends without a final answer', () => {
    const view = render([{
      id: 'tool-error', role: 'tool', kind: 'trace', content: '', timestamp: Date.now(),
      toolEvents: [{ phase: 'error', call_id: 'search-1', name: 'web_search', error: 'fatal failure' }],
    }], { isActive: false, turnLatencyMs: 12_000, hasBodyBelow: false });

    expect(view.textContent).toContain('未完成 12s');
  });

  it('updates one tool row from running to complete as gateway frames arrive', () => {
    const running: Message[] = [{
      id: 'tool-frame', role: 'tool', kind: 'trace', content: '', timestamp: 1,
      toolEvents: [{ phase: 'start', call_id: 'search-1', name: 'web_search', arguments: { query: '市场规模' } }],
    }];
    const view = render(running);

    expect(view.textContent).toContain('查询资料');
    expect(view.textContent).toContain('正在查找“市场规模”公开资料');

    render([...running, {
      id: 'tool-end', role: 'tool', kind: 'trace', content: '', timestamp: 2,
      toolEvents: [{ phase: 'end', call_id: 'search-1', name: 'web_search', result: '3 results' }],
    }]);

    // The completed row remains stable; the active-stream continuation is a
    // separate status row, not a duplicate tool event.
    expect(view.querySelectorAll('li')).toHaveLength(2);
    expect(view.textContent).toContain('已查到相关公开资料');
  });
});
