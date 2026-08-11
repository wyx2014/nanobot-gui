import type { CanonicalSessionEvent } from '@/core/types';

export interface CompletedTurnNotification {
  key: string;
  chatId: string;
  turnId?: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function chatIdFromSessionKey(sessionKey: string): string {
  return sessionKey.startsWith('websocket:')
    ? sessionKey.slice('websocket:'.length)
    : sessionKey;
}

/** Extract only successful, durable turn completions from the canonical feed. */
export function completedTurnNotificationFromEvent(
  event: CanonicalSessionEvent,
): CompletedTurnNotification | null {
  if (event.event !== 'turn_completed') return null;
  const payload = record(event.payload);
  const turn = record(event.turn) ?? record(payload?.turn);
  if (nonEmptyString(turn?.status) !== 'completed') return null;

  const chatId = nonEmptyString(event.chat_id)
    ?? nonEmptyString(payload?.chat_id)
    ?? chatIdFromSessionKey(event.session_key);
  if (!chatId) return null;
  const turnId = nonEmptyString(event.turn_id) ?? nonEmptyString(turn?.id);
  return {
    key: nonEmptyString(event.event_id) ?? `${event.session_key}:${turnId ?? event.event_seq}`,
    chatId,
    ...(turnId ? { turnId } : {}),
  };
}

/** Bound notification memory while suppressing replayed/reconnected events. */
export class CompletedTurnNotificationTracker {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];
  private readonly capacity: number;

  constructor(capacity = 512) {
    this.capacity = capacity;
  }

  consume(event: CanonicalSessionEvent): CompletedTurnNotification | null {
    const completion = completedTurnNotificationFromEvent(event);
    if (!completion || this.seen.has(completion.key)) return null;
    this.seen.add(completion.key);
    this.order.push(completion.key);
    while (this.order.length > this.capacity) {
      const oldest = this.order.shift();
      if (oldest) this.seen.delete(oldest);
    }
    return completion;
  }
}
