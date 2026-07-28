import { beforeEach, describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import {
  deriveWorkbenchProgress,
  useConversationWorkbenchStore,
} from './conversationWorkbenchStore';

function message(overrides: Partial<Message>): Message {
  return {
    id: 'message',
    role: 'tool',
    content: '',
    timestamp: 1,
    ...overrides,
  };
}

beforeEach(() => {
  useConversationWorkbenchStore.setState({
    progressByConversation: {},
    artifactRevisionByConversation: {},
  });
});

describe('deriveWorkbenchProgress', () => {
  it('prefers the latest structured task_progress snapshot', () => {
    const progress = deriveWorkbenchProgress([
      message({
        id: 'old',
        agentUI: {
          kind: 'task_progress',
          steps: [{ id: 'old-step', title: '旧计划', status: 'completed' }],
        },
      }),
      message({
        id: 'latest',
        agentUI: {
          kind: 'task_progress',
          note: '正在整理最终报告',
          current_step_id: 'write',
          steps: [
            { id: 'search', title: '检索资料', status: 'completed' },
            { id: 'write', title: '撰写报告', status: 'running', detail: '生成 PDF' },
          ],
        },
      }),
    ], true);

    expect(progress).toEqual({
      source: 'task_progress',
      isActive: true,
      note: '正在整理最终报告',
      steps: [
        { id: 'search', title: '检索资料', status: 'completed' },
        { id: 'write', title: '撰写报告', status: 'running', detail: '生成 PDF' },
      ],
    });
  });

  it('keeps tool activity out of the task plan', () => {
    const progress = deriveWorkbenchProgress([
      message({
        id: 'old-tool',
        toolEvents: [{ call_id: 'old', name: 'read_file', phase: 'end' }],
      }),
      message({ id: 'user', role: 'user', content: '分析市场' }),
      message({
        id: 'start',
        toolEvents: [{
          call_id: 'search-1',
          name: 'web_search',
          phase: 'start',
          display: { title: '搜索市场数据' },
        }],
      }),
      message({
        id: 'end',
        toolEvents: [{
          call_id: 'search-1',
          name: 'web_search',
          phase: 'end',
          display: { title: '已获取市场数据' },
        }],
      }),
      message({
        id: 'plan-tool',
        toolEvents: [{
          call_id: 'plan-1',
          name: 'update_task_progress',
          phase: 'end',
        }],
      }),
    ], false);

    expect(progress).toEqual({
      source: 'empty',
      isActive: false,
      steps: [],
    });
  });

  it('selects one latest snapshot without overlaying team and model plans', () => {
    const progress = deriveWorkbenchProgress([
      message({ id: 'user', role: 'user', content: '研究新易盛' }),
      message({
        id: 'persisted-team-snapshot',
        agentUI: {
          kind: 'task_progress',
          team_id: 'asset-research-team',
          team_run_id: 'run-1',
          note: '4 位专家正在并行研究',
          steps: [
            { id: 'business-analyst', title: '商业分析', status: 'completed' },
            { id: 'financial-analyst', title: '财务分析', status: 'running', detail: '查询财务指标' },
            { id: 'team-lead', title: '主笔汇总', status: 'pending' },
            { id: 'report-audit', title: '报告审校', status: 'pending' },
          ],
        },
      }),
      message({
        id: 'later-umbrella-plan',
        agentUI: {
          kind: 'task_progress',
          note: '正在进行报告审校',
          steps: [
            { id: 'data-package', title: '基础数据包', status: 'completed' },
            { id: 'team-lead', title: '交叉质证', status: 'completed' },
            { id: 'report-audit', title: '数据抽检与报告审计', status: 'running' },
          ],
        },
      }),
    ], true);

    expect(progress.steps).toEqual([
      { id: 'data-package', title: '基础数据包', status: 'completed' },
      { id: 'team-lead', title: '交叉质证', status: 'completed' },
      { id: 'report-audit', title: '数据抽检与报告审计', status: 'running' },
    ]);
    expect(progress.note).toBe('正在进行报告审校');
  });

  it('does not carry a completed plan into a later unrelated user turn', () => {
    const progress = deriveWorkbenchProgress([
      message({ id: 'first-user', role: 'user', content: '生成报告' }),
      message({
        id: 'old-plan',
        agentUI: {
          kind: 'task_progress',
          steps: [{ id: 'report', title: '生成报告', status: 'completed' }],
        },
      }),
      message({ id: 'second-user', role: 'user', content: '谢谢' }),
      message({ id: 'answer', role: 'assistant', content: '不客气' }),
    ], false);

    expect(progress).toEqual({
      steps: [],
      isActive: false,
      source: 'empty',
    });
  });
});

describe('conversationWorkbenchStore', () => {
  it('keeps progress and artifact refresh revisions scoped by conversation', () => {
    const store = useConversationWorkbenchStore.getState();
    store.setConversationProgress('chat-a', [
      message({
        agentUI: {
          kind: 'task_progress',
          steps: [{ id: 'one', title: '第一步', status: 'running' }],
        },
      }),
    ], true);
    store.requestArtifactRefresh('chat-a');
    store.requestArtifactRefresh('chat-a');

    expect(useConversationWorkbenchStore.getState().progressByConversation['chat-a']?.steps)
      .toHaveLength(1);
    expect(useConversationWorkbenchStore.getState().artifactRevisionByConversation['chat-a'])
      .toBe(2);
    expect(useConversationWorkbenchStore.getState().artifactRevisionByConversation['chat-b'])
      .toBeUndefined();
  });
});
