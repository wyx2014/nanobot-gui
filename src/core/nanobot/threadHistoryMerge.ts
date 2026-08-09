import type { ThreadResource, UIMessage } from '@/core/types';

/**
 * Preserve the latest locally visible user prompt when a canonical refresh
 * contains only the truncated tail of a long turn.
 *
 * The gateway normally anchors a truncated page with that turn's durable user
 * event. This guard keeps the optimistic prompt visible while reconnecting to
 * an older gateway, or while a page produced before that invariant is still in
 * flight.
 */
export function preserveLatestUserAnchor(
  current: UIMessage[],
  incoming: UIMessage[],
  page: ThreadResource['message_page'],
): UIMessage[] {
  if (!page?.has_more_before || incoming.some((message) => message.role === 'user')) {
    return incoming;
  }

  for (let index = current.length - 1; index >= 0; index -= 1) {
    const message = current[index];
    if (message.role !== 'user') continue;
    return [
      message,
      ...incoming.filter((candidate) => candidate.id !== message.id),
    ];
  }

  return incoming;
}
