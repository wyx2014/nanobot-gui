import type { CanonicalSessionEvent } from '@/core/types';

export interface CompletedTurnNotification {
  key: string;
  chatId: string;
  sessionKey: string;
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

function interactivePromptFromEvent(event: CanonicalSessionEvent): Record<string, unknown> | null {
  if (event.event !== 'message') return null;
  const payload = record(event.payload);
  return record(event.interactive_prompt) ?? record(payload?.interactive_prompt);
}

function inputScopeKeys(sessionKey: string, turnId?: string): string[] {
  return turnId
    ? [`${sessionKey}:turn:${turnId}`, `${sessionKey}:session`]
    : [`${sessionKey}:session`];
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
    sessionKey: event.session_key,
    ...(turnId ? { turnId } : {}),
  };
}

/** Bound notification memory while suppressing replayed/reconnected events. */
export class CompletedTurnNotificationTracker {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];
  private readonly awaitingUserInput = new Set<string>();
  private readonly capacity: number;

  constructor(capacity = 512) {
    this.capacity = capacity;
  }

  consume(event: CanonicalSessionEvent): CompletedTurnNotification | null {
    const prompt = interactivePromptFromEvent(event);
    if (prompt) {
      const promptTurnId = nonEmptyString(event.turn_id)
        ?? nonEmptyString(record(event.payload)?.turn_id);
      for (const key of inputScopeKeys(event.session_key, promptTurnId)) {
        if (nonEmptyString(prompt.status) === 'pending') {
          this.awaitingUserInput.add(key);
        } else {
          this.awaitingUserInput.delete(key);
        }
      }
    }

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

  /** Check after the short delivery grace period so an interactive-prompt
   * message queued just behind its terminal event can still suppress the
   * misleading completion notification. */
  shouldNotify(completion: CompletedTurnNotification): boolean {
    const keys = inputScopeKeys(completion.sessionKey, completion.turnId);
    let awaiting = false;
    for (const key of keys) {
      if (this.awaitingUserInput.delete(key)) awaiting = true;
    }
    return !awaiting;
  }

  reset(): void {
    this.seen.clear();
    this.order.length = 0;
    this.awaitingUserInput.clear();
  }
}
