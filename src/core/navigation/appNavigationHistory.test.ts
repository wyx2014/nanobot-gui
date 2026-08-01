import { describe, expect, it } from 'vitest';
import { AppNavigationHistory } from './appNavigationHistory';

describe('AppNavigationHistory', () => {
  it('moves backward and forward through conversations and views', () => {
    const history = new AppNavigationHistory({ viewMode: 'chat', conversationId: null });
    history.record({ viewMode: 'chat', conversationId: 'alpha' });
    history.record({ viewMode: 'toolbox', conversationId: null });

    expect(history.availability()).toEqual({ canGoBack: true, canGoForward: false });
    expect(history.back()).toEqual({ viewMode: 'chat', conversationId: 'alpha' });
    expect(history.back()).toEqual({ viewMode: 'chat', conversationId: null });
    expect(history.availability()).toEqual({ canGoBack: false, canGoForward: true });
    expect(history.forward()).toEqual({ viewMode: 'chat', conversationId: 'alpha' });
  });

  it('drops the forward branch after a new navigation and ignores duplicates', () => {
    const history = new AppNavigationHistory({ viewMode: 'chat', conversationId: null });
    expect(history.record({ viewMode: 'chat', conversationId: 'alpha' })).toBe(true);
    expect(history.record({ viewMode: 'chat', conversationId: 'alpha' })).toBe(false);
    history.record({ viewMode: 'settings', conversationId: null });

    history.back();
    history.record({ viewMode: 'schedule', conversationId: null });

    expect(history.availability()).toEqual({ canGoBack: true, canGoForward: false });
    expect(history.forward()).toBeNull();
  });
});
