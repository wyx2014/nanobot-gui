import { describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import { buildTaskNarrativeEntries } from './taskNarrativeTimeline';

function msg(partial: Partial<Message> & Pick<Message, 'id' | 'role'>): Message {
  return {
    content: '',
    timestamp: 1,
    ...partial,
  };
}

describe('buildTaskNarrativeEntries', () => {
  it('freezes completed reasoning even while the enclosing turn keeps streaming', () => {
    const [entry] = buildTaskNarrativeEntries([
      msg({
        id: 'reasoning-finished',
        role: 'assistant',
        thinking: '已完成这一段分析',
        reasoningStreaming: false,
        isStreaming: true,
        thinkingStartedAt: 1_000,
        thinkingCompletedAt: 13_000,
        thinkingDuration: 12,
      }),
    ]);

    expect(entry).toMatchObject({
      kind: 'analysis',
      status: 'done',
      startedAt: 1_000,
      completedAt: 13_000,
      durationMs: 12_000,
    });
  });

  it('keeps analysis, plan, and tools while omitting file changes', () => {
    const entries = buildTaskNarrativeEntries([
      msg({ id: 'reasoning', role: 'assistant', thinking: 'private reasoning summary' }),
      msg({
        id: 'plan',
        role: 'tool',
        kind: 'trace',
        agentUI: {
          kind: 'task_progress',
          steps: [
            { id: 'research', title: '查询行业数据', status: 'running' },
            { id: 'report', title: '撰写报告', status: 'pending' },
          ],
        },
      }),
      msg({
        id: 'tool',
        role: 'tool',
        kind: 'trace',
        toolEvents: [{
          phase: 'start',
          call_id: 'call-search',
          name: 'web_search',
          arguments: { query: 'IDC 行业' },
        }],
      }),
      msg({
        id: 'file',
        role: 'tool',
        kind: 'trace',
        fileEdits: [{
          call_id: 'call-write',
          tool: 'write_file',
          path: 'idc-report.html',
          added: 120,
          deleted: 0,
          status: 'editing',
        }],
      }),
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual(['analysis', 'plan', 'tool']);
    expect(entries[1]).toMatchObject({
      title: '整理计划',
      detail: '处理：查询行业数据',
      status: 'running',
    });
    expect(entries[2]).toMatchObject({
      title: '查询资料',
      status: 'running',
    });
    expect(JSON.stringify(entries)).not.toContain('idc-report.html');
  });

  it('keeps generated-file tools concise without file cards or technical paths', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'pdf-start',
        role: 'tool',
        kind: 'trace',
        toolEvents: [{
          phase: 'start',
          call_id: 'create-pdf',
          name: 'create_pdf',
          arguments: {
            source_path: '/project/reports/report.md',
            output_path: '/project/reports/report.pdf',
          },
        }],
      }),
      msg({
        id: 'pdf-end',
        role: 'tool',
        kind: 'trace',
        toolEvents: [{
          phase: 'end',
          call_id: 'create-pdf',
          name: 'create_pdf',
          result: {
            files: [{
              path: '/project/reports/report.pdf',
              name: 'report.pdf',
              mime_type: 'application/pdf',
            }],
          },
          files: [{
            path: '/project/reports/report.pdf',
            name: 'report.pdf',
            mime_type: 'application/pdf',
          }],
        }],
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'tool',
      status: 'done',
      detail: '产物已生成',
      artifactOutput: true,
    });
    expect(entries[0].input).toBeUndefined();
    expect(entries[0].result).toBeUndefined();
    expect(entries[0].evidence).toBeUndefined();
    expect(JSON.stringify(entries)).not.toContain('report.pdf');
  });

  it('updates tool phases in place by call_id', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'start',
        role: 'tool',
        kind: 'trace',
        toolEvents: [{
          phase: 'start',
          call_id: 'call-1',
          name: 'exec',
          arguments: { command: 'python fetch.py' },
        }],
      }),
      msg({
        id: 'end',
        role: 'tool',
        kind: 'trace',
        toolEvents: [{
          phase: 'end',
          call_id: 'call-1',
          name: 'exec',
          result: '7 companies loaded',
        }],
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'tool:call-1',
      title: '运行命令',
      status: 'done',
      input: { command: 'python fetch.py' },
      result: '7 companies loaded',
    });
  });

  it('shows write_stdin as waiting for a background command, not writing a file', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'wait',
        role: 'tool',
        kind: 'trace',
        toolEvents: [{
          phase: 'start',
          call_id: 'call-wait',
          name: 'write_stdin',
          arguments: { session_id: 'abc123', wait_for: 'ready' },
          display: { category: 'command', importance: 'primary' },
        }],
      }),
    ]);

    expect(entries[0]).toMatchObject({
      title: '等待后台命令',
      status: 'running',
    });
  });

  it('builds a plan from update_task_progress tool input for older transcripts', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'legacy-plan',
        role: 'tool',
        kind: 'trace',
        toolEvents: [{
          phase: 'start',
          call_id: 'plan-1',
          name: 'update_task_progress',
          arguments: {
            steps: [
              { id: 'collect', title: '收集市场数据', status: 'completed' },
              { id: 'draft', title: '撰写报告', status: 'completed' },
            ],
          },
        }],
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'plan',
      title: '整理计划',
      detail: '校验：已完成 2 项计划',
      status: 'done',
    });
  });

  it('keeps provider thinking content in the collapsible timeline entry', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'reasoning',
        role: 'assistant',
        thinking: 'Inspect the filings, then compare the reported figures.',
        reasoningStreaming: true,
      }),
    ]);

    expect(entries).toEqual([{
      id: 'reasoning:analysis',
      kind: 'analysis',
      title: '整理思路',
      content: 'Inspect the filings, then compare the reported figures.',
      detail: '正在分析任务',
      status: 'running',
      source: 'reasoning',
      occurredAt: 1,
    }]);
  });

  it('keeps each reasoning round in its original position', () => {
    const entries = buildTaskNarrativeEntries([
      msg({ id: 'reasoning-1', role: 'assistant', thinking: 'first thought' }),
      msg({
        id: 'tool-1',
        role: 'tool',
        kind: 'trace',
        toolEvents: [{
          phase: 'end',
          call_id: 'search-1',
          name: 'web_search',
          result: 'ok',
        }],
      }),
      msg({ id: 'reasoning-2', role: 'assistant', thinking: 'second thought' }),
      msg({
        id: 'tool-2',
        role: 'tool',
        kind: 'trace',
        toolEvents: [{
          phase: 'end',
          call_id: 'fetch-1',
          name: 'web_fetch',
          result: 'ok',
        }],
      }),
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual([
      'analysis',
      'tool',
      'analysis',
      'tool',
    ]);
    expect(entries.filter((entry) => entry.kind === 'analysis')).toHaveLength(2);
    expect(entries.filter((entry) => entry.kind === 'analysis').map((entry) => entry.content))
      .toEqual(['first thought', 'second thought']);
  });

  it('renders provider thinking and public narration as ordered entries', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'reasoning',
        role: 'assistant',
        thinking: 'Check the detailed market data first.',
        reasoningStreaming: false,
      }),
      msg({
        id: 'narration',
        role: 'tool',
        kind: 'trace',
        narration: 'Let me fetch more detailed market data from specific articles.',
        narrationStreaming: false,
      }),
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual(['analysis', 'narration']);
    expect(entries[0]).toMatchObject({
      title: '整理思路',
      content: 'Check the detailed market data first.',
      detail: '已完成任务分析',
    });
    expect(entries[1]).toMatchObject({
      title: 'Let me fetch more detailed market data from specific articles.',
      content: 'Let me fetch more detailed market data from specific articles.',
      status: 'done',
    });
  });

  it('retains both thinking and narration when they share a message', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'combined-thinking',
        role: 'assistant',
        thinking: 'Compare the source tables before the next tool call.',
        reasoningStreaming: true,
        narration: 'I will inspect the source next.',
        narrationStreaming: true,
      }),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: 'combined-thinking:analysis',
      kind: 'analysis',
      content: 'Compare the source tables before the next tool call.',
      status: 'running',
    });
    expect(entries[1]).toMatchObject({
      id: 'combined-thinking:narration',
      kind: 'narration',
      title: 'I will inspect the source next.',
      content: 'I will inspect the source next.',
      status: 'running',
    });
  });

  it('preserves tool start and completion timestamps while updating in place', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'start',
        role: 'tool',
        timestamp: 1_785_000_000_000,
        kind: 'trace',
        toolEvents: [{
          phase: 'start',
          call_id: 'call-timed',
          name: 'web_search',
          occurred_at: 1_785_000_000_100,
        }],
      }),
      msg({
        id: 'end',
        role: 'tool',
        timestamp: 1_785_000_001_000,
        kind: 'trace',
        toolEvents: [{
          phase: 'end',
          call_id: 'call-timed',
          name: 'web_search',
          occurred_at: 1_785_000_000_900,
          result: 'ok',
        }],
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'tool:call-timed',
      status: 'done',
      startedAt: 1_785_000_000_100,
      completedAt: 1_785_000_000_900,
    });
  });

  it('groups structured parallel tool calls and keeps gateway sequence order', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'parallel',
        role: 'tool',
        kind: 'trace',
        toolEvents: [
          {
            phase: 'start',
            call_id: 'company',
            name: 'mcp_finance',
            sequence: 12,
            batch_id: 'turn-1:2',
            display: { category: 'mcp', importance: 'primary' },
            arguments: { ticker: 'GDS' },
          },
          {
            phase: 'start',
            call_id: 'industry',
            name: 'web_search',
            sequence: 11,
            batch_id: 'turn-1:2',
            display: { category: 'search', importance: 'primary' },
            arguments: { query: 'IDC 行业规模' },
          },
        ],
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'batch:turn-1:2',
      kind: 'batch',
      title: '并行执行',
      detail: '正在并行处理 2 项任务',
      status: 'running',
      sequence: 11,
    });
    expect(entries[0].childEntries?.map((entry) => entry.id)).toEqual([
      'tool:industry',
      'tool:company',
    ]);
    expect(entries[0].childEntries?.map((entry) => entry.title)).toEqual([
      '查询资料',
      '查询外部数据',
    ]);
  });

  it('hides plan-barrier preflight calls that never actually executed', () => {
    const blockedError = [
      'Error [PLAN_REQUIRED]: this turn has become a multi-step task.',
      'Call update_task_progress first.',
    ].join(' ');
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'blocked-start',
        role: 'tool',
        kind: 'trace',
        toolEvents: [
          {
            phase: 'start',
            call_id: 'blocked-cn',
            name: 'web_search',
            batch_id: 'turn-1:0',
            arguments: { query: '中国出口' },
          },
          {
            phase: 'start',
            call_id: 'blocked-en',
            name: 'web_search',
            batch_id: 'turn-1:0',
            arguments: { query: 'China exports' },
          },
        ],
      }),
      msg({
        id: 'blocked-error',
        role: 'tool',
        kind: 'trace',
        toolEvents: [
          {
            phase: 'error',
            call_id: 'blocked-cn',
            name: 'web_search',
            batch_id: 'turn-1:0',
            error: blockedError,
          },
          {
            phase: 'error',
            call_id: 'blocked-en',
            name: 'web_search',
            batch_id: 'turn-1:0',
            error: blockedError,
          },
        ],
      }),
      msg({
        id: 'actual-search',
        role: 'tool',
        kind: 'trace',
        toolEvents: [{
          phase: 'end',
          call_id: 'actual-search',
          name: 'web_search',
          batch_id: 'turn-1:2',
          arguments: { query: '中国出口' },
          result: 'results',
        }],
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'tool:actual-search',
      title: '查询资料',
      status: 'done',
    });
    expect(JSON.stringify(entries)).not.toContain('blocked-cn');
    expect(JSON.stringify(entries)).not.toContain('blocked-en');
    expect(JSON.stringify(entries)).not.toContain('并行执行');
  });

  it('shows role-specific expert research instead of generic parallel steps', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'team-run-1',
        role: 'tool',
        kind: 'trace',
        agentUI: {
          kind: 'task_progress',
          note: '四位专家将并行研究',
          steps: [
            { id: 'business-analyst', title: '商业分析师', detail: '正在查询同花顺公司摘要', status: 'running' },
            { id: 'financial-analyst', title: '财务分析师', detail: '正在查询同花顺财务指标', status: 'running' },
            { id: 'team-lead', title: 'Team Lead 交叉质证与汇总', status: 'pending' },
            { id: 'report-audit', title: '财务数据抽检与生成报告', status: 'pending' },
          ],
        },
      }),
      msg({
        id: 'model-plan',
        role: 'tool',
        kind: 'trace',
        agentUI: {
          kind: 'task_progress',
          note: '三个维度需要 Team Lead 补齐',
          steps: [
            { id: 'team-lead-summary', title: 'Team Lead：汇总最终报告', status: 'running' },
            { id: 'data-audit', title: '数据抽检与准出', status: 'pending' },
          ],
        },
      }),
      msg({
        id: 'expert-spawns',
        role: 'tool',
        kind: 'trace',
        toolEvents: [
          {
            phase: 'start',
            call_id: 'business',
            name: 'spawn',
            sequence: 11,
            batch_id: 'turn-1:2',
            display: { category: 'expert', importance: 'primary', title: '商业模式分析', subject: '研究主营业务与护城河' },
            arguments: { label: 'business-analyst', task: 'business task' },
          },
          {
            phase: 'start',
            call_id: 'financial',
            name: 'spawn',
            sequence: 12,
            batch_id: 'turn-1:2',
            display: { category: 'expert', importance: 'primary', title: '财务质量与估值', subject: '核验财务与估值' },
            arguments: { label: 'financial-analyst', task: 'financial task' },
          },
        ],
      }),
      msg({
        id: 'lead-search',
        role: 'tool',
        kind: 'trace',
        toolEvents: [{
          phase: 'start',
          call_id: 'lead-query',
          name: 'web_search',
          arguments: { query: '青岛啤酒现金流核验' },
        }],
      }),
    ]);

    expect(entries[0]).toMatchObject({
      kind: 'plan',
      title: '专家团队研究',
      planSteps: [
        { id: 'business-analyst', detail: '正在查询同花顺公司摘要' },
        { id: 'financial-analyst', detail: '正在查询同花顺财务指标' },
        {
          id: 'team-lead',
          status: 'running',
          detail: '正在查找“青岛啤酒现金流核验”公开资料',
        },
        { id: 'report-audit', status: 'pending' },
      ],
    });
    expect(entries.filter((entry) => entry.kind === 'plan')).toHaveLength(1);
    expect(entries).toHaveLength(1);
  });

  it('uses spawn as a member-status fallback and keeps the active team plan after thinking', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'team-run-fallback',
        role: 'tool',
        kind: 'trace',
        agentUI: {
          kind: 'task_progress',
          plan_kind: 'workflow',
          team_id: 'asset-research-team',
          team_run_id: 'run-fallback',
          note: '正在启动四位专家',
          steps: [
            {
              id: 'business-analyst',
              title: '商业模式分析',
              detail: '分析主营业务、生意属性与护城河',
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
      msg({
        id: 'spawn-reasoning',
        role: 'assistant',
        thinking: '准备四位研究员的任务描述，然后同时启动他们。',
        reasoningStreaming: true,
        isStreaming: true,
      }),
      msg({
        id: 'spawn-fallback',
        role: 'tool',
        kind: 'trace',
        toolEvents: [{
          phase: 'end',
          call_id: 'spawn-business',
          name: 'spawn',
          arguments: {
            label: 'business-analyst',
            task: '分析商业模式',
          },
          result: 'Subagent [business-analyst] started',
        }],
      }),
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual(['analysis', 'plan']);
    expect(entries.at(-1)).toMatchObject({
      title: '专家团队研究',
      status: 'running',
      planSteps: [
        {
          id: 'business-analyst',
          status: 'running',
          detail: '研究员已启动，正在等待首个研究进展',
        },
        {
          id: 'team-lead',
          status: 'pending',
        },
      ],
    });
  });

  it('does not show pre-research data packaging as Team Lead synthesis', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'initial-model-plan',
        role: 'tool',
        kind: 'trace',
        agentUI: {
          kind: 'task_progress',
          note: '正在构建同花顺基础数据包',
          steps: [
            { id: 'team-lead', title: 'Team Lead：构建基础数据包', status: 'running' },
            { id: 'business-analyst', title: '商业模式分析', status: 'pending' },
            { id: 'financial-analyst', title: '财务与估值分析', status: 'pending' },
            { id: 'industry-researcher', title: '行业与竞争分析', status: 'pending' },
            { id: 'risk-assessor', title: '风险与治理评估', status: 'pending' },
            { id: 'team-lead-summary', title: 'Team Lead：汇总最终报告', status: 'pending' },
            { id: 'report-audit', title: '数据抽检与报告输出', status: 'pending' },
          ],
        },
      }),
      msg({
        id: 'team-run-legacy-plan',
        role: 'tool',
        kind: 'trace',
        agentUI: {
          kind: 'task_progress',
          note: '四位专家将并行研究',
          steps: [
            { id: 'business-analyst', title: '商业模式分析', status: 'pending' },
            { id: 'financial-analyst', title: '财务与估值分析', status: 'pending' },
            { id: 'industry-researcher', title: '行业与竞争分析', status: 'pending' },
            { id: 'risk-assessor', title: '风险与治理评估', status: 'pending' },
            { id: 'team-lead', title: 'Team Lead 汇总与交叉质证', status: 'pending' },
            { id: 'report-audit', title: '数据抽检与最终报告', status: 'pending' },
          ],
        },
      }),
    ]);

    expect(entries[0]).toMatchObject({
      title: '专家团队研究',
      planSteps: [
        { id: 'business-analyst', status: 'pending' },
        { id: 'financial-analyst', status: 'pending' },
        { id: 'industry-researcher', status: 'pending' },
        { id: 'risk-assessor', status: 'pending' },
        { id: 'team-lead', status: 'pending' },
        { id: 'report-audit', status: 'pending' },
      ],
    });
  });

  it('does not let stale model progress reopen completed expert-team stages', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'stale-model-progress',
        role: 'tool',
        kind: 'trace',
        agentUI: {
          kind: 'task_progress',
          note: '主笔正在交叉质证与汇总',
          steps: [
            { id: 'team-lead-summary', title: '主笔交叉质证与汇总', status: 'running' },
            { id: 'report-audit', title: '报告审校与交付', status: 'pending' },
          ],
        },
      }),
      msg({
        id: 'team-run-terminal',
        role: 'tool',
        kind: 'trace',
        agentUI: {
          kind: 'task_progress',
          plan_kind: 'workflow',
          team_id: 'asset-research-team',
          team_run_id: 'run-1',
          status: 'completed',
          revision: 7,
          note: '研究与报告已完成',
          active_step_ids: [],
          steps: [
            {
              id: 'team-lead',
              title: '主笔交叉质证与汇总',
              detail: '已完成成员结论的交叉质证与汇总',
              status: 'completed',
            },
            {
              id: 'report-audit',
              title: '报告审校与交付',
              detail: '最终报告已完成审校并交付',
              status: 'completed',
            },
          ],
        },
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: '专家团队研究',
      detail: '研究与报告已完成',
      status: 'done',
      planSteps: [
        {
          id: 'team-lead',
          status: 'completed',
          detail: '已完成成员结论的交叉质证与汇总',
        },
        {
          id: 'report-audit',
          status: 'completed',
          detail: '最终报告已完成审校并交付',
        },
      ],
    });
  });

  it('terminalizes stale active steps when a failed expert plan arrives', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'team-run-failed',
        role: 'tool',
        kind: 'trace',
        agentUI: {
          kind: 'task_progress',
          plan_kind: 'workflow',
          team_id: 'asset-research-team',
          team_run_id: 'run-failed',
          status: 'failed',
          revision: 9,
          note: '专家团队执行失败',
          active_step_ids: ['team-lead'],
          current_step_id: 'team-lead',
          steps: [
            {
              id: 'data-package',
              title: '建立基础数据包',
              status: 'completed',
            },
            {
              id: 'team-lead',
              title: '主笔交叉质证与汇总',
              status: 'running',
            },
            {
              id: 'report-audit',
              title: '报告审校与交付',
              status: 'pending',
            },
          ],
        },
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: '专家团队研究',
      detail: '专家团队执行失败',
      status: 'error',
      planSteps: [
        { id: 'data-package', status: 'completed' },
        { id: 'team-lead', status: 'error' },
        { id: 'report-audit', status: 'skipped' },
      ],
    });
  });

  it('uses a public task progress note without exposing reasoning', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'plan-note',
        role: 'tool',
        kind: 'trace',
        agentUI: {
          kind: 'task_progress',
          note: '凭证已保存，现在拉取行业和公司数据',
          current_step_id: 'collect',
          steps: [{ id: 'collect', title: '收集市场数据', status: 'pending' }],
        },
      }),
    ]);

    expect(entries[0]).toMatchObject({
      kind: 'plan',
      title: '整理计划',
      detail: '凭证已保存，现在拉取行业和公司数据',
      status: 'running',
    });
  });

  it('renders a runtime-generated plan carried by a synthetic tool event', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'auto-plan',
        role: 'tool',
        kind: 'trace',
        toolEvents: [{
          phase: 'end',
          call_id: 'auto-task-progress:turn-1',
          name: 'update_task_progress',
          sequence: 1000,
          batch_id: 'turn-1',
          arguments: {
            note: '任务进入多步骤处理，继续执行下一阶段',
            current_step_id: 'auto-command-1',
            steps: [{
              id: 'auto-command-1',
              title: '处理任务数据',
              status: 'pending',
            }],
          },
        }],
      }),
    ]);

    expect(entries[0]).toMatchObject({
      kind: 'plan',
      detail: '任务进入多步骤处理，继续执行下一阶段',
      status: 'running',
      planSteps: [{
        id: 'auto-command-1',
        title: '处理任务数据',
        status: 'running',
      }],
    });
  });
});
