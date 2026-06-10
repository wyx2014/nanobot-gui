/**
 * Shared context utilities — used by contextManager, contextCompressor, and tokenEstimator
 */

import type { Message, MessageContent } from '../../types';

export const RECENT_ROUNDS_TO_KEEP = 4;

/**
 * Get text content from a Message
 */
export function getMessageText(content: string | MessageContent[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

/**
 * Identify conversation "rounds" — a user message + following assistant message(s)
 */
export function identifyRounds(messages: Message[]): Message[][] {
  const rounds: Message[][] = [];
  let current: Message[] = [];

  for (const msg of messages) {
    if (msg.role === 'user' && current.length > 0) {
      rounds.push(current);
      current = [];
    }
    current.push(msg);
  }
  if (current.length > 0) {
    rounds.push(current);
  }

  return rounds;
}
