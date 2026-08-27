import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactFromPath } from '@/core/artifacts';
import { useChatStore } from '@/stores/chatStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useBrowserStore } from '@/stores/browserStore';
import RightPanel from './RightPanel';

const mocks = vi.hoisted(() => ({ workbenchMountCount: 0 }));

vi.mock('./ConversationWorkbench', async () => {
  const { useState } = await vi.importActual<typeof import('react')>('react');
  function MockConversationWorkbench({ showInitialLoading }: { showInitialLoading?: boolean }) {
    const [mountId] = useState(() => ++mocks.workbenchMountCount);
    const [initialLoading] = useState(showInitialLoading);
    return (
      <div
        data-testid="conversation-workbench"
        data-mount-id={mountId}
        data-initial-loading={String(Boolean(initialLoading))}
      >
        Workbench
      </div>
    );
  }
  return {
    default: MockConversationWorkbench,
  };
});

vi.mock('./PreviewPanel', () => ({
  default: () => <div data-testid="preview-panel">Preview</div>,
}));

vi.mock('./BrowserPanel', () => ({
  default: () => <div data-testid="browser-panel">Browser</div>,
}));

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<RightPanel />));
  return container;
}

beforeEach(() => {
  mocks.workbenchMountCount = 0;
  useSettingsStore.setState({ viewMode: 'chat', rightPanelCollapsed: false });
  useChatStore.setState({
    activeConversationId: 'chat-1',
    conversations: {
      'chat-1': {
        id: 'chat-1',
        title: 'Test',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
        status: 'idle',
      },
    },
  });
  usePreviewStore.getState().closePreview();
  useBrowserStore.setState({ sessions: {} });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  usePreviewStore.getState().closePreview();
});

describe('RightPanel pinned conversation summary', () => {
  it('floats the pinned summary over the chat without reserving layout width', () => {
    const view = render();
    // No spacer: the conversation keeps its full width, so the chat header
    // buttons and the content scrollbar stay pinned to the window's right edge.
    expect(view.querySelector('[data-pinned-summary-spacer]')).toBeNull();

    expect(view.querySelector('[data-pinned-summary-host]')).not.toBeNull();
    expect(view.querySelector('[data-testid="conversation-workbench"]')).not.toBeNull();
    expect(view.querySelector('[data-testid="preview-panel"]')).toBeNull();

    act(() => useSettingsStore.getState().setRightPanelCollapsed(true));
    expect(view.querySelector('[data-pinned-summary-host]')).toBeNull();
    expect(view.querySelector('[data-testid="conversation-workbench"]')).toBeNull();
  });

  it('remounts conversation details when the active conversation changes', () => {
    useChatStore.setState((state) => ({
      conversations: {
        ...state.conversations,
        'chat-2': {
          id: 'chat-2',
          title: 'Second chat',
          messages: [],
          createdAt: 2,
          updatedAt: 2,
          status: 'idle',
        },
      },
    }));
    const view = render();
    const firstMount = view.querySelector('[data-testid="conversation-workbench"]')
      ?.getAttribute('data-mount-id');

    act(() => useChatStore.getState().switchConversation('chat-2'));

    const secondMount = view.querySelector('[data-testid="conversation-workbench"]')
      ?.getAttribute('data-mount-id');
    expect(secondMount).not.toBe(firstMount);
    expect(view.querySelector('[data-testid="conversation-workbench"]')
      ?.getAttribute('data-initial-loading')).toBe('true');
  });

  it('reopens the same conversation summary without an initial loader', () => {
    const view = render();

    act(() => useSettingsStore.getState().setRightPanelCollapsed(true));
    act(() => useSettingsStore.getState().setRightPanelCollapsed(false));

    expect(view.querySelector('[data-testid="conversation-workbench"]')
      ?.getAttribute('data-initial-loading')).toBe('false');
  });

  it('replaces the rail with the existing preview and preserves full-width expansion', () => {
    const view = render();

    act(() => usePreviewStore.getState().openArtifact(artifactFromPath('/workspace/report.pdf')));
    const panel = view.firstElementChild as HTMLDivElement;
    expect(view.querySelector('[data-testid="preview-panel"]')).not.toBeNull();
    expect(panel.style.getPropertyValue('--conversation-panel-width')).toBe('min(62vw, 960px)');

    act(() => usePreviewStore.getState().toggleExpanded());
    expect(panel.style.getPropertyValue('--conversation-panel-width')).toBe('100vw');
  });

  it('opens the session browser rail while keeping artifact preview higher priority', () => {
    const view = render();
    act(() => useBrowserStore.getState().handleEvent({
      event: 'browser_frame',
      chat_id: 'chat-1',
      browser_session_id: 'chat-1',
      backend: 'playwright_mcp',
      image_base64: 'frame',
      mime_type: 'image/jpeg',
      captured_at: 1,
    }));

    const panel = view.firstElementChild as HTMLDivElement;
    expect(view.querySelector('[data-testid="browser-panel"]')).not.toBeNull();
    expect(panel.style.getPropertyValue('--conversation-panel-width')).toBe('min(42vw, 560px)');

    act(() => usePreviewStore.getState().openArtifact(artifactFromPath('/workspace/report.pdf')));
    expect(view.querySelector('[data-testid="preview-panel"]')).not.toBeNull();
    expect(view.querySelector('[data-testid="browser-panel"]')).toBeNull();
  });

  it('stays hidden on the new-chat welcome screen', () => {
    useChatStore.setState({ activeConversationId: null });
    const view = render();
    expect(view.childElementCount).toBe(0);
  });
});
