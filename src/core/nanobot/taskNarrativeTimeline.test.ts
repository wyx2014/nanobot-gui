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
  it('keeps analysis, plan, tools, and file changes in arrival order', () => {
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

    expect(entries.map((entry) => entry.kind)).toEqual(['analysis', 'plan', 'tool', 'file']);
    expect(entries[1]).toMatchObject({
      title: '整理计划',
      detail: '处理：查询行业数据',
      status: 'running',
    });
    expect(entries[2]).toMatchObject({
      title: '查询资料',
      status: 'running',
    });
    expect(entries[3]).toMatchObject({
      title: '写入文件',
      detail: 'idc-report.html',
      status: 'running',
    });
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

  it('does not expose reasoning content in the public timeline entry', () => {
    const entries = buildTaskNarrativeEntries([
      msg({
        id: 'reasoning',
        role: 'assistant',
        thinking: 'hidden chain of thought must not be rendered',
        reasoningStreaming: true,
      }),
    ]);

    expect(entries).toEqual([{
      id: 'reasoning:analysis',
      kind: 'analysis',
      title: '整理思路',
      detail: '正在分析任务',
      status: 'running',
      source: 'reasoning',
    }]);
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
