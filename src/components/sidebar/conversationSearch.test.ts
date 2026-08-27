import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/types';
import {
  matchesConversationFilters,
  matchesConversationSearch,
  matchesProjectSearch,
} from './conversationSearch';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    title: '季度复盘',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    status: 'idle',
    ...overrides,
  };
}

describe('sidebar conversation search', () => {
  it('matches conversation titles without case or full-width differences', () => {
    expect(matchesConversationSearch(conversation({ title: 'Release PLAN' }), 'release plan')).toBe(true);
    expect(matchesConversationSearch(conversation({ title: 'ＴＰＣｏｗｏｒｋ' }), 'tpcowork')).toBe(true);
  });

  it('matches text from string and multimodal messages', () => {
    const item = conversation({
      messages: [
        { id: '1', role: 'user', content: '整理销售数据', timestamp: 1 },
        {
          id: '2',
          role: 'assistant',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
            { type: 'text', text: '已生成华东区域报告' },
          ],
          timestamp: 2,
        },
      ],
    });

    expect(matchesConversationSearch(item, '销售数据')).toBe(true);
    expect(matchesConversationSearch(item, '华东区域')).toBe(true);
    expect(matchesConversationSearch(item, '华南区域')).toBe(false);
  });

  it('matches project context and treats an empty query as all conversations', () => {
    const item = conversation();
    expect(matchesConversationSearch(item, 'nanobot-gui', ['nanobot-gui', '/workspace/nanobot-gui'])).toBe(true);
    expect(matchesConversationSearch(item, '  ')).toBe(true);
  });

  it('matches project names and paths', () => {
    expect(matchesProjectSearch('desktop', 'TPA Desktop', '/workspace/gui')).toBe(true);
    expect(matchesProjectSearch('nanobot', 'TPA Desktop', '/workspace/nanobot-gui')).toBe(true);
    expect(matchesProjectSearch('mobile', 'TPA Desktop', '/workspace/nanobot-gui')).toBe(false);
  });

  it('maps durable idle conversations and transient completed conversations to completed', () => {
    const filters = { status: 'completed', time: 'all' } as const;

    expect(matchesConversationFilters(conversation({ status: 'idle' }), filters)).toBe(true);
    expect(matchesConversationFilters(conversation({ status: 'completed' }), filters)).toBe(true);
    expect(matchesConversationFilters(conversation({ status: 'running' }), filters)).toBe(false);
    expect(matchesConversationFilters(conversation({ status: 'error' }), filters)).toBe(false);
  });

  it('filters running and failed conversations by their authoritative status', () => {
    expect(matchesConversationFilters(
      conversation({ status: 'running' }),
      { status: 'running', time: 'all' },
    )).toBe(true);
    expect(matchesConversationFilters(
      conversation({ status: 'error' }),
      { status: 'running', time: 'all' },
    )).toBe(false);
    expect(matchesConversationFilters(
      conversation({ status: 'error' }),
      { status: 'error', time: 'all' },
    )).toBe(true);
  });

  it('uses local calendar-day boundaries for time filters', () => {
    const now = new Date(2026, 7, 26, 15, 30).getTime();
    const todayStart = new Date(2026, 7, 26).getTime();
    const sevenDayStart = new Date(2026, 7, 20).getTime();
    const thirtyDayStart = new Date(2026, 6, 28).getTime();

    expect(matchesConversationFilters(
      conversation({ updatedAt: todayStart }),
      { status: 'all', time: 'today' },
      now,
    )).toBe(true);
    expect(matchesConversationFilters(
      conversation({ updatedAt: todayStart - 1 }),
      { status: 'all', time: 'today' },
      now,
    )).toBe(false);
    expect(matchesConversationFilters(
      conversation({ updatedAt: sevenDayStart }),
      { status: 'all', time: '7-days' },
      now,
    )).toBe(true);
    expect(matchesConversationFilters(
      conversation({ updatedAt: sevenDayStart - 1 }),
      { status: 'all', time: '7-days' },
      now,
    )).toBe(false);
    expect(matchesConversationFilters(
      conversation({ updatedAt: thirtyDayStart }),
      { status: 'all', time: '30-days' },
      now,
    )).toBe(true);
  });
});
