import { describe, expect, it } from 'vitest';
import type { UIMessage } from '@/core/types';
import { preserveLatestUserAnchor } from './threadHistoryMerge';

function message(
  id: string,
  role: UIMessage['role'],
  content: string,
): UIMessage {
  return { id, role, content, createdAt: 1 };
}

describe('preserveLatestUserAnchor', () => {
  it('keeps the latest local user prompt when the durable page starts mid-turn', () => {
    const current = [
      message('older-user', 'user', 'older question'),
      message('latest-user', 'user', '帮我分析下 长江电力'),
      message('live-trace', 'tool', 'working'),
    ];
    const incoming = [
      message('durable-trace', 'tool', 'latest progress'),
      message('answer', 'assistant', 'report'),
    ];

    expect(preserveLatestUserAnchor(current, incoming, {
      before_event_seq: 1421,
      has_more_before: true,
      loaded_message_count: 2,
    })).toEqual([current[1], ...incoming]);
  });

  it('uses the durable user row when the gateway supplied the turn anchor', () => {
    const current = [message('local-user', 'user', 'local prompt')];
    const incoming = [
      message('durable-user', 'user', 'durable prompt'),
      message('answer', 'assistant', 'report'),
    ];

    expect(preserveLatestUserAnchor(current, incoming, {
      before_event_seq: 920,
      has_more_before: true,
      loaded_message_count: 2,
    })).toBe(incoming);
  });

  it('does not mix local state into a complete durable page', () => {
    const current = [message('local-user', 'user', 'local prompt')];
    const incoming = [message('answer', 'assistant', 'report')];

    expect(preserveLatestUserAnchor(current, incoming, {
      before_event_seq: null,
      has_more_before: false,
      loaded_message_count: 1,
    })).toBe(incoming);
  });
});
