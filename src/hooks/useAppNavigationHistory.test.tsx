import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAppNavigationHistory } from './useAppNavigationHistory';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function NavigationHarness() {
  const navigation = useAppNavigationHistory(true);
  return (
    <>
      <button type="button" data-testid="back" disabled={!navigation.canGoBack} onClick={navigation.goBack}>
        Back
      </button>
      <button type="button" data-testid="forward" disabled={!navigation.canGoForward} onClick={navigation.goForward}>
        Forward
      </button>
    </>
  );
}

async function flushNavigation() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(async () => {
  useSettingsStore.setState({ viewMode: 'chat' });
  useChatStore.setState({
    conversations: {},
    activeConversationId: null,
    conversationNavigationHistory: [],
  });
  useChatStore.getState().createConversation(null, {
    id: 'alpha',
    title: 'Alpha',
    skipActivate: true,
  });

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<NavigationHarness />);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe('useAppNavigationHistory', () => {
  it('restores the welcome screen and selected conversation', async () => {
    act(() => useChatStore.getState().switchConversation('alpha'));
    await flushNavigation();

    const back = container?.querySelector<HTMLButtonElement>('[data-testid="back"]');
    const forward = container?.querySelector<HTMLButtonElement>('[data-testid="forward"]');
    expect(back?.disabled).toBe(false);

    act(() => back?.click());
    expect(useChatStore.getState().activeConversationId).toBeNull();
    expect(forward?.disabled).toBe(false);

    act(() => forward?.click());
    expect(useChatStore.getState().activeConversationId).toBe('alpha');
  });

  it('moves back from another app view to the current conversation', async () => {
    act(() => useChatStore.getState().switchConversation('alpha'));
    await flushNavigation();
    act(() => useSettingsStore.getState().setViewMode('toolbox'));
    await flushNavigation();

    const back = container?.querySelector<HTMLButtonElement>('[data-testid="back"]');
    act(() => back?.click());

    expect(useSettingsStore.getState().viewMode).toBe('chat');
    expect(useChatStore.getState().activeConversationId).toBe('alpha');
  });
});
