import type { Conversation, MessageContent } from '@/types';

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
