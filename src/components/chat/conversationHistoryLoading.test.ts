import { describe, expect, it } from 'vitest';
import { shouldShowConversationLoading } from './conversationHistoryLoading';

describe('shouldShowConversationLoading', () => {
  it('shows the initial loader for a newly selected conversation', () => {
    expect(shouldShowConversationLoading('new-chat', null)).toBe(true);
  });

  it('keeps an already hydrated conversation visible during later refreshes', () => {
    expect(shouldShowConversationLoading('active-chat', 'active-chat')).toBe(false);
  });

  it('shows the loader when switching to a conversation whose history is not hydrated', () => {
    expect(shouldShowConversationLoading('next-chat', 'previous-chat')).toBe(true);
  });

  it('does not show a conversation loader on the home screen', () => {
    expect(shouldShowConversationLoading(undefined, 'previous-chat')).toBe(false);
  });
});
