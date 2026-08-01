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
  options: {
    isActive?: boolean;
    turnLatencyMs?: number;
    activeElapsedMs?: number;
    hasBodyBelow?: boolean;
  } = {},
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
      activeElapsedMs={options.activeElapsedMs}
      hasBodyBelow={options.hasBodyBelow}
    />,
  ));
  return container;
}

function trace(partial: Partial<Message> & Pick<Message, 'id'>): Message {
  return {
    role: 'tool',
    kind: 'trace',
    content: '',
    timestamp: Date.now(),
    ...partial,
  };
}

describe('TaskNarrativeTimeline Hope Agent-compatible UI', () => {
  it('removes the old ToolStep summary and animates only the active timeline item', () => {
    const view = render([trace({
      id: 'tool-frame',
      toolEvents: [{
        phase: 'start',
        call_id: 'search-1',
        name: 'web_search',
        arguments: { query: '市场规模' },
      }],
    })]);

    expect(view.querySelector('[data-toolstep-summary]')).toBeNull();
    expect(view.querySelector('[data-hope-toolstep]')).not.toBeNull();
    expect(view.querySelectorAll('[data-hope-timeline-item][data-active="true"]')).toHaveLength(1);
    expect(view.querySelectorAll('[data-hope-ripple]')).toHaveLength(2);
    expect(view.querySelectorAll('[data-hope-tool]')).toHaveLength(1);
    expect(view.querySelector('.animate-spin')).toBeNull();
    expect(view.textContent).toContain('查询资料');
    expect(view.textContent).toContain('市场规模');
  });

  it('keeps a single completed tool visible after answer text begins', () => {
    const view = render([trace({
      id: 'tool-end',
      toolEvents: [{
        phase: 'end',
        call_id: 'search-1',
        name: 'web_search',
        result: '3 results',
      }],
    })], {
      isActive: true,
      hasBodyBelow: true,
      turnLatencyMs: 548_000,
    });

    expect(view.querySelector('[data-hope-processed]')).toBeNull();
    expect(view.querySelector('[data-hope-tool]')).not.toBeNull();
    expect(view.querySelectorAll('[data-hope-timeline-item][data-active="true"]')).toHaveLength(0);
    expect(view.querySelectorAll('[data-hope-ripple]')).toHaveLength(0);
  });

  it('folds one terminal expert plan into the completed ToolStep above the answer', () => {
    const view = render([trace({
      id: 'terminal-team-plan',
      agentUI: {
        kind: 'task_progress',
        plan_kind: 'workflow',
        team_id: 'asset-research-team',
        team_run_id: 'run-failed',
        status: 'failed',
        note: '专家团队执行失败',
        active_step_ids: ['team-lead'],
        current_step_id: 'team-lead',
        steps: [
          { id: 'team-lead', title: '主笔交叉质证与汇总', status: 'running' },
          { id: 'report-audit', title: '报告审校与交付', status: 'pending' },
        ],
      },
    })], {
      isActive: false,
      hasBodyBelow: true,
      turnLatencyMs: 912_000,
    });

    const processed = view.querySelector<HTMLButtonElement>('button[aria-label="展开已处理步骤"]');
    expect(processed?.textContent).toContain('已处理');
    expect(processed?.textContent).toContain('15m12s');
    expect(processed?.textContent).toContain('1 项失败');
    expect(view.querySelector('[data-hope-plan]')).toBeNull();

    act(() => processed?.click());
    expect(view.querySelector('[data-hope-plan]')).not.toBeNull();
    expect(view.textContent).toContain('专家团队执行失败');
  });

  it('folds two or more completed process units only after answer text begins', () => {
    const view = render([
      trace({
        id: 'thought',
        narration: '先核验公司基础资料。',
        narrationStreaming: false,
      }),
      trace({
        id: 'tool-end',
        toolEvents: [{
          phase: 'end',
          call_id: 'search-1',
          name: 'web_search',
          result: '3 results',
        }],
      }),
    ], {
      isActive: true,
      hasBodyBelow: true,
      turnLatencyMs: 548_000,
    });

    const processed = view.querySelector<HTMLButtonElement>('button[aria-label="展开已处理步骤"]');
    expect(processed?.getAttribute('aria-expanded')).toBe('false');
    expect(processed?.textContent).toContain('已处理');
    expect(processed?.textContent).toContain('9m8s');
    expect(view.querySelector('[data-hope-thinking]')).toBeNull();
    expect(view.querySelector('[data-hope-tool]')).toBeNull();

    act(() => processed?.click());

    expect(processed?.getAttribute('aria-expanded')).toBe('true');
    expect(view.querySelector('[data-hope-thinking]')).not.toBeNull();
    expect(view.querySelector('[data-hope-tool]')).not.toBeNull();
  });

  it('does not flash completed work into a processed row before answer text arrives', () => {
    const view = render([
      trace({ id: 'thought', narration: '先检查资料。', narrationStreaming: false }),
      trace({
        id: 'tool-end',
        toolEvents: [{ phase: 'end', call_id: 'search-1', name: 'web_search', result: 'ok' }],
      }),
    ], {
      isActive: true,
      hasBodyBelow: false,
    });

    expect(view.querySelector('[data-hope-processed]')).toBeNull();
    expect(view.querySelector('[data-hope-thinking]')).not.toBeNull();
    expect(view.querySelector('[data-hope-tool]')).not.toBeNull();
  });

  it('groups consecutive tools into one stable Hope tool group', () => {
    const view = render([
      trace({
        id: 'tool-1',
        toolEvents: [{ phase: 'start', call_id: 'search-1', name: 'web_search', arguments: { query: 'A' } }],
      }),
      trace({
        id: 'tool-2',
        toolEvents: [{ phase: 'start', call_id: 'search-2', name: 'web_search', arguments: { query: 'B' } }],
      }),
    ]);

    expect(view.querySelectorAll('[data-hope-tool-group]')).toHaveLength(1);
    expect(view.querySelectorAll('[data-hope-tool]')).toHaveLength(2);
    expect(view.querySelectorAll('[data-hope-timeline-item][data-active="true"]')).toHaveLength(1);
    expect(view.querySelectorAll('[data-hope-ripple]')).toHaveLength(2);
    expect(view.textContent).toContain('正在执行 2 项操作');
    expect([...view.querySelectorAll('[data-hope-group-member-status]')].map((node) => node.textContent))
      .toEqual(['进行中', '进行中']);
    expect(
      [...view.querySelectorAll('[data-hope-tool][data-group-member="true"] [data-hope-tool-label]')]
        .some((node) => node.classList.contains('hope-text-shimmer')),
    ).toBe(false);

    const group = view.querySelector<HTMLButtonElement>('[data-hope-tool-group] > button');
    act(() => group?.click());
    expect(group?.getAttribute('aria-expanded')).toBe('false');
    expect(view.querySelectorAll('[data-hope-tool]')).toHaveLength(0);
  });

  it('auto-expands labelled parallel work and collapses it after completion', () => {
    const runningMessages = [
      trace({
        id: 'parallel-1',
        toolEvents: [{
          phase: 'start',
          call_id: 'parallel-search',
          batch_id: 'parallel-batch',
          name: 'web_search',
          arguments: { query: '行业数据' },
        }],
      }),
      trace({
        id: 'parallel-2',
        toolEvents: [{
          phase: 'start',
          call_id: 'parallel-finance',
          batch_id: 'parallel-batch',
          name: 'mcp',
          arguments: { server: 'juyuan', action: '查询财务指标' },
        }],
      }),
    ];
    const view = render(runningMessages);
    const group = view.querySelector<HTMLButtonElement>('[data-hope-tool-group] > button');

    expect(group?.getAttribute('aria-expanded')).toBe('true');
    expect(group?.textContent).toContain('并行执行 · 2 项');
    expect(view.querySelectorAll('[data-hope-tool][data-group-member="true"]')).toHaveLength(2);

    render([
      ...runningMessages,
      trace({
        id: 'parallel-1-done',
        toolEvents: [{
          phase: 'end',
          call_id: 'parallel-search',
          batch_id: 'parallel-batch',
          name: 'web_search',
          result: 'ok',
        }],
      }),
      trace({
        id: 'parallel-2-done',
        toolEvents: [{
          phase: 'end',
          call_id: 'parallel-finance',
          batch_id: 'parallel-batch',
          name: 'mcp',
          result: 'ok',
        }],
      }),
    ], { isActive: false });

    const completedGroup = view.querySelector<HTMLButtonElement>('[data-hope-tool-group] > button');
    expect(completedGroup?.getAttribute('aria-expanded')).toBe('false');
    expect(completedGroup?.textContent).toContain('已并行完成 2 项');
    expect(view.querySelectorAll('[data-hope-tool]')).toHaveLength(0);
  });

  it('shows duration only on the parallel group, not on each child task', () => {
    const startedAt = 1_785_000_000_000;
    const view = render([
      trace({
        id: 'parallel-start-1',
        toolEvents: [{
          phase: 'start',
          call_id: 'parallel-search',
          batch_id: 'parallel-duration',
          name: 'web_search',
          occurred_at: startedAt,
          arguments: { query: '行业数据' },
        }],
      }),
      trace({
        id: 'parallel-start-2',
        toolEvents: [{
          phase: 'start',
          call_id: 'parallel-finance',
          batch_id: 'parallel-duration',
          name: 'mcp',
          occurred_at: startedAt + 1_000,
          arguments: { server: 'juyuan' },
        }],
      }),
      trace({
        id: 'parallel-end-1',
        toolEvents: [{
          phase: 'end',
          call_id: 'parallel-search',
          batch_id: 'parallel-duration',
          name: 'web_search',
          occurred_at: startedAt + 4_000,
          result: 'ok',
        }],
      }),
      trace({
        id: 'parallel-end-2',
        toolEvents: [{
          phase: 'end',
          call_id: 'parallel-finance',
          batch_id: 'parallel-duration',
          name: 'mcp',
          occurred_at: startedAt + 5_000,
          result: 'ok',
        }],
      }),
    ], { isActive: false });

    const groupButton = view.querySelector<HTMLButtonElement>('[data-hope-tool-group] > button');
    expect(groupButton?.textContent).toContain('耗时 5s');
    act(() => groupButton?.click());
    const members = view.querySelector<HTMLElement>('[data-hope-tool-group-members]');
    expect(members?.textContent).not.toContain('耗时');
  });

  it('shows one quiet loading tail after a tool completes between model rounds', () => {
    const view = render([trace({
      id: 'tool-end',
      toolEvents: [{ phase: 'end', call_id: 'search-1', name: 'web_search', result: 'ok' }],
    })]);

    const activeItem = view.querySelector('[data-hope-timeline-item][data-active="true"]');
    expect(activeItem?.querySelector('[data-hope-loading]')).not.toBeNull();
    expect(view.querySelector('[data-hope-tool]')).not.toBeNull();
    expect(view.querySelectorAll('[data-hope-ripple]')).toHaveLength(2);
  });

  it('renders provider thinking and public narration in Hope thinking blocks', () => {
    const view = render([{
      id: 'narration',
      role: 'assistant',
      content: '',
      thinking: 'Inspect the source tables before choosing the next query.',
      narration: 'Let me fetch more detailed market data from specific articles.',
      narrationStreaming: true,
      reasoningStreaming: true,
      timestamp: Date.now(),
    }]);

    expect(view.textContent).toContain('正在思考');
    expect(view.textContent).toContain('Let me fetch more detailed market data from specific articles.');
    expect(view.querySelectorAll('[data-hope-thinking]')).toHaveLength(2);

    const thinkingButtons = view.querySelectorAll<HTMLButtonElement>('[data-hope-thinking] > button');
    act(() => thinkingButtons[0]?.click());
    expect(view.textContent).toContain('Inspect the source tables before choosing the next query.');
  });

  it('collapses completed provider thinking and lets the user reopen it', () => {
    const view = render([{
      id: 'reasoning',
      role: 'assistant',
      content: '',
      thinking: '先比较财务口径，再核验公开来源。',
      reasoningStreaming: false,
      timestamp: Date.now(),
    }], { isActive: false });

    const thinking = view.querySelector<HTMLButtonElement>('[data-hope-thinking] > button');
    expect(thinking?.getAttribute('aria-expanded')).toBe('false');
    expect(view.textContent).not.toContain('先比较财务口径，再核验公开来源。');
    expect(view.textContent).toContain('已思考');

    act(() => thinking?.click());
    expect(thinking?.getAttribute('aria-expanded')).toBe('true');
    expect(view.textContent).toContain('先比较财务口径，再核验公开来源。');
  });

  it('freezes completed thinking time even while the rest of the turn is active', () => {
    const view = render([{
      id: 'reasoning-frozen',
      role: 'assistant',
      content: '',
      thinking: '思考已完成，后续工具仍在运行。',
      thinkingDuration: 12,
      reasoningStreaming: false,
      isStreaming: true,
      timestamp: Date.now(),
    }], {
      isActive: true,
      activeElapsedMs: 60_000,
    });

    expect(view.textContent).toContain('已思考');
    expect(view.textContent).toContain('耗时 12s');
    expect(view.textContent).not.toContain('耗时 1m');
  });

  it('keeps tool result and raw payload hidden until their Hope controls are opened', () => {
    const view = render([trace({
      id: 'tool-details',
      toolEvents: [{
        phase: 'end',
        call_id: 'exec-1',
        name: 'exec',
        arguments: { command: 'echo safe-summary', secret: 'private-input' },
        result: 'private-result',
      }],
    })], { isActive: false });

    expect(view.textContent).toContain('echo safe-summary');
    expect(view.textContent).not.toContain('private-input');
    expect(view.textContent).not.toContain('private-result');

    const toolToggle = view.querySelector<HTMLButtonElement>('[data-hope-tool] button[aria-expanded]');
    act(() => toolToggle?.click());
    expect(view.textContent).toContain('private-result');
    expect(view.textContent).not.toContain('private-input');

    const rawToggle = view.querySelector<HTMLButtonElement>('[data-hope-raw-toggle]');
    act(() => rawToggle?.click());
    expect(view.textContent).toContain('private-input');
  });

  it('preserves thought-tool-thought-tool order without the old step-card projection', () => {
    const view = render([
      trace({ id: 'thought-1', narration: '先确认公司基础资料。', narrationStreaming: false }),
      trace({
        id: 'tool-1',
        toolEvents: [{ phase: 'end', call_id: 'search-company', name: 'web_search', result: 'ok' }],
      }),
      trace({ id: 'thought-2', narration: '接下来核验行业数据。', narrationStreaming: false }),
      trace({
        id: 'tool-2',
        toolEvents: [{ phase: 'end', call_id: 'search-industry', name: 'web_fetch', result: 'ok' }],
      }),
    ], { isActive: false });

    const units = [...view.querySelectorAll<HTMLElement>('[data-hope-thinking], [data-hope-tool]')];
    expect(units.map((unit) => unit.getAttribute('data-entry-id'))).toEqual([
      'thought-1:narration',
      'tool:search-company',
      'thought-2:narration',
      'tool:search-industry',
    ]);
  });

  it('keeps generated artifact steps concise and hides file paths', () => {
    const view = render([
      trace({
        id: 'file-edit',
        fileEdits: [{
          call_id: 'write-1',
          tool: 'write_file',
          path: 'reports/report.md',
          absolute_path: '/project/reports/report.md',
          added: 102,
          deleted: 0,
          status: 'done',
        }],
      }),
      trace({
        id: 'pdf-output',
        toolEvents: [{
          phase: 'end',
          call_id: 'pdf-1',
          name: 'create_pdf',
          arguments: {
            source_path: '/project/reports/report.md',
            output_path: '/project/reports/report.pdf',
          },
          files: [{
            path: '/project/reports/report.pdf',
            name: 'report.pdf',
            mime_type: 'application/pdf',
          }],
        }],
      }),
    ], { isActive: false });

    expect(view.textContent).toContain('产物已生成');
    expect(view.textContent).not.toContain('report.md');
    expect(view.textContent).not.toContain('report.pdf');
  });

  it('shows failure state without turning every row into an animation', () => {
    const view = render([trace({
      id: 'tool-error',
      toolEvents: [{
        phase: 'error',
        call_id: 'search-1',
        name: 'web_search',
        error: 'fatal failure',
      }],
    })], { isActive: false, hasBodyBelow: false });

    expect(view.querySelector('[data-hope-tool][data-status="error"]')).not.toBeNull();
    expect(view.querySelector('[data-hope-timeline-item][data-tone="failed"]')).not.toBeNull();
    expect(view.querySelectorAll('[data-hope-ripple]')).toHaveLength(0);
  });

  it('keeps live spawn reasoning open while showing the expert workflow beneath it', () => {
    const view = render([
      trace({
        id: 'team-plan',
        agentUI: {
          kind: 'task_progress',
          plan_kind: 'workflow',
          team_id: 'asset-research-team',
          team_run_id: 'run-live',
          note: '正在启动四位专家',
          steps: [
            {
              id: 'financial-analyst',
              title: '财务质量与估值',
              detail: '核验财务报表与估值',
              status: 'pending',
            },
            {
              id: 'team-lead',
              title: '主笔交叉质证与汇总',
              status: 'pending',
            },
          ],
        },
      }),
      trace({
        id: 'spawn-thinking',
        role: 'assistant',
        kind: undefined,
        thinking: '让我准备研究任务，然后使用 spawn 启动后台代理。',
        reasoningStreaming: true,
        isStreaming: true,
      }),
      trace({
        id: 'spawn-call',
        toolEvents: [{
          phase: 'end',
          call_id: 'spawn-finance',
          name: 'spawn',
          arguments: {
            label: 'financial-analyst',
            task: '核验财务报表与估值',
          },
          result: 'Subagent [financial-analyst] started',
        }],
      }),
    ]);

    const thinkingButton = view.querySelector<HTMLButtonElement>('[data-hope-thinking] > button');
    const planButton = view.querySelector<HTMLButtonElement>('[data-hope-plan] > button');
    const activeItem = view.querySelector('[data-hope-timeline-item][data-active="true"]');

    expect(thinkingButton?.getAttribute('aria-expanded')).toBe('true');
    expect(planButton?.getAttribute('aria-expanded')).toBe('true');
    expect(activeItem?.querySelector('[data-hope-plan]')).not.toBeNull();
    expect(view.textContent).toContain('让我准备研究任务，然后使用 spawn 启动后台代理。');
    expect(view.textContent).toContain('研究员已启动，正在等待首个研究进展');
  });
});
