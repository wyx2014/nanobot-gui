import { describe, expect, it } from 'vitest';
import type { CanonicalSessionEvent } from '@/core/types';
import {
  CompletedTurnNotificationTracker,
  completedTurnNotificationFromEvent,
} from './taskCompletionNotification';

function event(status: string, eventId = 'terminal-1'): CanonicalSessionEvent {
  return {
    schema_version: 2,
    event_id: eventId,
    event_seq: 9,
    event: 'turn_completed',
    recorded_at: 10,
    project_id: 'project-1',
    session_id: 'session-1',
    session_key: 'websocket:chat-1',
    turn_id: 'turn-1',
    chat_id: 'chat-1',
    turn: { id: 'turn-1', status },
  };
}

describe('task completion notifications', () => {
  it('extracts successful completed turns', () => {
    expect(completedTurnNotificationFromEvent(event('completed'))).toEqual({
      key: 'terminal-1',
      chatId: 'chat-1',
      turnId: 'turn-1',
    });
  });

  it('ignores failures, cancellations, and non-terminal events', () => {
    expect(completedTurnNotificationFromEvent(event('failed'))).toBeNull();
    expect(completedTurnNotificationFromEvent(event('interrupted'))).toBeNull();
    expect(completedTurnNotificationFromEvent({
      ...event('completed'),
      event: 'message',
    })).toBeNull();
  });

  it('notifies once when a durable event is replayed', () => {
    const tracker = new CompletedTurnNotificationTracker();
    expect(tracker.consume(event('completed'))).not.toBeNull();
    expect(tracker.consume(event('completed'))).toBeNull();
    expect(tracker.consume(event('completed', 'terminal-2'))).not.toBeNull();
  });
});
