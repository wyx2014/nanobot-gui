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

function render(messages: Message[]) {
  if (!container) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  act(() => root?.render(<TaskNarrativeTimeline messages={messages} isActive />));
  return container;
}

describe('TaskNarrativeTimeline streaming UI', () => {
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
