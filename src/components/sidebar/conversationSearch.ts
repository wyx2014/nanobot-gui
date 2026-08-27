import type { Conversation, MessageContent } from '@/types';

export type ConversationStatusFilter = 'all' | 'running' | 'completed' | 'error';
export type ConversationTimeFilter = 'all' | 'today' | '7-days' | '30-days';

export interface ConversationFilters {
  status: ConversationStatusFilter;
  time: ConversationTimeFilter;
}

function normalizeSearchValue(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function messageContentText(content: string | MessageContent[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((item): item is Extract<MessageContent, { type: 'text' }> => item.type === 'text')
    .map((item) => item.text)
    .join(' ');
}

export function matchesConversationSearch(
  conversation: Conversation,
  query: string,
  projectContext: readonly string[] = [],
): boolean {
  const normalizedQuery = normalizeSearchValue(query.trim());
  if (!normalizedQuery) return true;

  const searchableText = [
    conversation.title,
    ...projectContext,
    ...conversation.messages.map((message) => messageContentText(message.content)),
  ]
    .filter(Boolean)
    .join('\n');

  return normalizeSearchValue(searchableText).includes(normalizedQuery);
}

export function matchesProjectSearch(
  query: string,
  ...projectFields: Array<string | null | undefined>
): boolean {
  const normalizedQuery = normalizeSearchValue(query.trim());
  if (!normalizedQuery) return true;
  return normalizeSearchValue(projectFields.filter(Boolean).join('\n')).includes(normalizedQuery);
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function startOfLocalDayOffset(timestamp: number, dayOffset: number): number {
  const date = new Date(startOfLocalDay(timestamp));
  date.setDate(date.getDate() + dayOffset);
  return date.getTime();
}

export function matchesConversationFilters(
  conversation: Conversation,
  filters: ConversationFilters,
  now = Date.now(),
): boolean {
  const matchesStatus = filters.status === 'all'
    || conversation.status === filters.status
    || (filters.status === 'completed' && conversation.status === 'idle');

  if (!matchesStatus || filters.time === 'all') return matchesStatus;

  const days = filters.time === 'today' ? 1 : filters.time === '7-days' ? 7 : 30;
  const cutoff = startOfLocalDayOffset(now, -(days - 1));
  return conversation.updatedAt >= cutoff;
}
