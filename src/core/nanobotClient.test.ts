import { describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import { mapWebuiThreadToGuiMessages, projectGatewayMessagesForHistory } from './nanobotClient';

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
});
