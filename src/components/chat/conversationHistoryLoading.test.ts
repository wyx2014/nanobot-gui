import { describe, expect, it } from 'vitest';
import { shouldShowConversationLoading } from './conversationHistoryLoading';

describe('shouldShowConversationLoading', () => {
  it('shows the initial loader for a newly selected conversation', () => {
    expect(shouldShowConversationLoading('new-chat', null, false)).toBe(true);
  });

  it('keeps loading active while an already hydrated conversation refreshes remotely', () => {
    expect(shouldShowConversationLoading('active-chat', 'active-chat', true)).toBe(true);
  });

  it('shows an already hydrated conversation after its remote refresh finishes', () => {
    expect(shouldShowConversationLoading('active-chat', 'active-chat', false)).toBe(false);
  });

  it('shows the loader when switching to a conversation whose history is not hydrated', () => {
    expect(shouldShowConversationLoading('next-chat', 'previous-chat', false)).toBe(true);
  });

  it('does not show a conversation loader on the home screen', () => {
    expect(shouldShowConversationLoading(undefined, 'previous-chat', true)).toBe(false);
  });
});
