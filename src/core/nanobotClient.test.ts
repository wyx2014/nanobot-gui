import { describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import { mergeGatewayMessagesWithLocal } from './nanobotClient';

describe('mergeGatewayMessagesWithLocal', () => {
  it('preserves local user messages when gateway replay is missing users', () => {
    const local: Message[] = [
      { id: 'u1', role: 'user', content: '用户的问题', timestamp: 1, loopId: 'loop-1' },
      { id: 'a1', role: 'assistant', content: '旧回答', timestamp: 2, loopId: 'loop-1' },
    ];
    const gateway: Message[] = [
      { id: 'ga1', role: 'assistant', content: '网关回答', timestamp: 3, loopId: '' },
    ];

    const merged = mergeGatewayMessagesWithLocal(local, gateway);

    expect(merged.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(merged[0].content).toBe('用户的问题');
    expect(merged[1].content).toBe('网关回答');
    expect(merged[1].loopId).toBe('loop-1');
  });

  it('uses gateway replay directly when it contains user messages', () => {
    const local: Message[] = [
      { id: 'u1', role: 'user', content: '旧问题', timestamp: 1, loopId: 'loop-1' },
    ];
    const gateway: Message[] = [
      { id: 'gu1', role: 'user', content: '网关问题', timestamp: 2, loopId: 'loop-2' },
      { id: 'ga1', role: 'assistant', content: '网关回答', timestamp: 3, loopId: 'loop-2' },
    ];

    expect(mergeGatewayMessagesWithLocal(local, gateway)).toBe(gateway);
  });
});
