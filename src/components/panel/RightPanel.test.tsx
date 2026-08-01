import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactFromPath } from '@/core/artifacts';
import { useChatStore } from '@/stores/chatStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useBrowserStore } from '@/stores/browserStore';
import RightPanel from './RightPanel';

vi.mock('./ConversationWorkbench', () => ({
  default: () => <div data-testid="conversation-workbench">Workbench</div>,
}));

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
  useSettingsStore.setState({ viewMode: 'chat' });
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

describe('RightPanel conversation workbench', () => {
  it('shows the persistent workbench for an active chat without a selected artifact', () => {
    const view = render();
    const panel = view.firstElementChild as HTMLDivElement;

    expect(view.querySelector('[data-testid="conversation-workbench"]')).not.toBeNull();
    expect(view.querySelector('[data-testid="preview-panel"]')).toBeNull();
    expect(panel.style.getPropertyValue('--conversation-panel-width')).toBe('332px');
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
