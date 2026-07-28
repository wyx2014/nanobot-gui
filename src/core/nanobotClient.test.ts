import { describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import {
  conversationFromSessionSummary,
  mapWebuiThreadToGuiMessages,
  projectGatewayMessagesForHistory,
  shouldPreserveRunningConversation,
  stripRedundantMcpMentionPrefix,
} from './nanobotClient';

describe('conversationFromSessionSummary', () => {
  it('hydrates only metadata and preserves already loaded messages', () => {
    const existing = {
      id: 'chat-a',
      title: '已有标题',
      messages: [{ id: 'm1', role: 'user' as const, content: '历史', timestamp: 1 }],
      createdAt: 1,
      updatedAt: 2,
      status: 'idle' as const,
    };

    const conversation = conversationFromSessionSummary({
      key: 'websocket:chat-a',
      channel: 'websocket',
      chatId: 'chat-a',
      sessionId: 'ses-a',
      projectId: 'prj-a',
      createdAt: '2026-07-26T10:00:00',
      updatedAt: '2026-07-26T11:00:00',
      title: '',
      preview: '第一条用户消息',
      runStartedAt: 123,
      workspaceScope: null,
      expertTeam: null,
    }, existing);

    expect(conversation.messages).toBe(existing.messages);
    expect(conversation.title).toBe('已有标题');
    expect(conversation.status).toBe('running');
    expect(conversation.sessionId).toBe('ses-a');
    expect(conversation.projectId).toBe('prj-a');
    expect(conversation.hasHistory).toBe(true);
  });

  it('uses the server preview without loading a thread for a new session', () => {
    const conversation = conversationFromSessionSummary({
      key: 'websocket:chat-b',
      channel: 'websocket',
      chatId: 'chat-b',
      createdAt: null,
      updatedAt: null,
      title: '',
      preview: '帮我分析启动速度',
      runStartedAt: null,
    });

    expect(conversation.title).toBe('帮我分析启动速度');
    expect(conversation.messages).toEqual([]);
    expect(conversation.status).toBe('idle');
    expect(conversation.hasHistory).toBe(true);
  });
});

describe('shouldPreserveRunningConversation', () => {
  it('only protects a local running snapshot while the gateway still has an active run', () => {
    expect(shouldPreserveRunningConversation('running', 123, null)).toBe(true);
    expect(shouldPreserveRunningConversation('running', null, 123)).toBe(true);
    expect(shouldPreserveRunningConversation('running', null, null)).toBe(false);
    expect(shouldPreserveRunningConversation('idle', 123, 123)).toBe(false);
  });
});

describe('projectGatewayMessagesForHistory', () => {
  it('uses gateway history as the canonical transcript', () => {
    const gateway: Message[] = [
      { id: 'gu1', role: 'user', content: '网关问题', timestamp: 2, loopId: 'loop-2' },
      { id: 'ga1', role: 'assistant', content: '网关回答', timestamp: 3, loopId: 'loop-2' },
    ];

    expect(projectGatewayMessagesForHistory(gateway)).toEqual(gateway);
  });

  it('does not synthesize local user turns when gateway history is missing users', () => {
    const gateway: Message[] = [
      {
        id: 'gt1',
        role: 'tool',
        kind: 'trace',
        content: '',
        timestamp: 3,
        loopId: '',
        toolEvents: [{ phase: 'end', call_id: 'call-1', name: 'message', result: '已生成图表' }],
        mediaAttachments: [{ path: '/tmp/chart.svg', kind: 'image' }],
      },
      { id: 'ga1', role: 'assistant', content: '网关回答', timestamp: 4, loopId: '' },
    ];

    const projected = projectGatewayMessagesForHistory(gateway);

    expect(projected.map((message) => message.id)).toEqual(['gt1', 'ga1']);
    expect(projected[0].mediaAttachments).toEqual([{ path: '/tmp/chart.svg', kind: 'image' }]);
  });

  it('dedupes repeated gateway turns with the same content', () => {
    const gateway: Message[] = [
      { id: 'gu1', role: 'user', content: '查相关度', timestamp: 1000, loopId: 'loop-1' },
      { id: 'ga1', role: 'assistant', content: '相关度结果', timestamp: 2000, loopId: 'loop-1' },
      { id: 'gu2', role: 'user', content: '查相关度', timestamp: 3000, loopId: 'loop-2' },
      { id: 'ga2', role: 'assistant', content: '相关度结果', timestamp: 4000, loopId: 'loop-2' },
    ];

    const projected = projectGatewayMessagesForHistory(gateway);

    expect(projected.map((message) => message.id)).toEqual(['gu1', 'ga1']);
  });

  it('does not dedupe repeated questions when the answer differs', () => {
    const gateway: Message[] = [
      { id: 'gu1', role: 'user', content: '查相关度', timestamp: 1000, loopId: 'loop-1' },
      { id: 'ga1', role: 'assistant', content: '第一次结果', timestamp: 2000, loopId: 'loop-1' },
      { id: 'gu2', role: 'user', content: '查相关度', timestamp: 3000, loopId: 'loop-2' },
      { id: 'ga2', role: 'assistant', content: '第二次结果', timestamp: 4000, loopId: 'loop-2' },
    ];

    const projected = projectGatewayMessagesForHistory(gateway);

    expect(projected.map((message) => message.id)).toEqual(['gu1', 'ga1', 'gu2', 'ga2']);
  });
});

describe('mapWebuiThreadToGuiMessages artifacts', () => {
  it('hides a legacy MCP mention prefix while preserving the connector attachment', () => {
    const messages = mapWebuiThreadToGuiMessages([{
      id: 'user-with-connector',
      role: 'user',
      content: '@juyuan\n\n帮我分析下啤酒股票',
      createdAt: 1,
      mcpPresets: [{ name: 'juyuan', display_name: '聚源' }],
    }]);

    expect(messages[0].content).toBe('帮我分析下啤酒股票');
    expect(messages[0].mcpPresets).toEqual([{ name: 'juyuan', display_name: '聚源' }]);
  });

  it('removes only the MCP token from a mixed capability prefix', () => {
    expect(stripRedundantMcpMentionPrefix(
      '@terminal @juyuan\n分析贵州茅台',
      [{ name: 'juyuan' }],
    )).toBe('@terminal\n分析贵州茅台');
  });

  it('does not rewrite natural-language connector references', () => {
    expect(stripRedundantMcpMentionPrefix(
      '请比较 @juyuan 的数据来源',
      [{ name: 'juyuan' }],
    )).toBe('请比较 @juyuan 的数据来源');
  });

  it('restores persisted public narration as an activity trace', () => {
    const messages = mapWebuiThreadToGuiMessages([{
      id: 'narration-history',
      role: 'tool',
      kind: 'trace',
      content: '',
      narration: 'I will inspect the detailed source articles.',
      narrationStreaming: false,
      createdAt: 1,
    }]);

    expect(messages[0]).toMatchObject({
      id: 'narration-history',
      role: 'tool',
      kind: 'trace',
      content: '',
      narration: 'I will inspect the detailed source articles.',
      narrationStreaming: false,
    });
  });

  it('preserves server turn latency for task duration summaries', () => {
    const messages = mapWebuiThreadToGuiMessages([{
      id: 'assistant-latency',
      role: 'assistant',
      content: '完成',
      createdAt: 1,
      latencyMs: 548_000,
    }]);

    expect(messages[0].thinkingDuration).toBe(548);
  });

  it('preserves signed PDF preview and download metadata from gateway history', () => {
    const messages = mapWebuiThreadToGuiMessages([{
      id: 'assistant-pdf',
      role: 'assistant',
      content: '报告已生成',
      createdAt: 1,
      media: [{
        kind: 'file',
        url: '/api/media/sig/payload',
        download_url: '/api/media/sig/payload?download=1',
        name: 'report.pdf',
        mime_type: 'application/pdf',
        size: 2048,
      }],
    }]);

    expect(messages[0].mediaAttachments).toEqual([{
      id: undefined,
      url: '/api/media/sig/payload',
      downloadUrl: '/api/media/sig/payload?download=1',
      localPath: undefined,
      name: 'report.pdf',
      kind: 'file',
      mimeType: 'application/pdf',
      size: 2048,
    }]);
  });

  it('dedupes a generated artifact restored with a new signed URL', () => {
    const messages = mapWebuiThreadToGuiMessages([{
      id: 'assistant-html',
      role: 'assistant',
      content: '报告已生成',
      createdAt: 1,
      media: [
        {
          kind: 'file',
          url: '/api/media/streamed-signature/report',
          name: '上海咖啡馆研究.html',
          mime_type: 'text/html',
          size: 4096,
        },
        {
          kind: 'file',
          url: '/api/media/replayed-signature/report',
          local_path: '/workspace/上海咖啡馆研究.html',
          name: '上海咖啡馆研究.html',
          mime_type: 'text/html',
          size: 4096,
        },
      ],
    }]);

    expect(messages[0].mediaAttachments).toHaveLength(1);
    expect(messages[0].mediaAttachments?.[0]?.localPath).toBe('/workspace/上海咖啡馆研究.html');
  });
});
