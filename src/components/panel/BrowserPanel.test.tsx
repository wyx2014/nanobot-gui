import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getI18n } from '@/i18n';
import { useBrowserStore } from '@/stores/browserStore';
import { isWindows } from '@/utils/platform';
import BrowserPanel from './BrowserPanel';

const { browserControl } = vi.hoisted(() => ({
  browserControl: vi.fn(),
}));

vi.mock('@/core/nanobotClient', () => ({
  getNanobotClient: () => ({ browserControl }),
}));

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function renderPanel() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<BrowserPanel chatId="chat-1" />));
}

beforeEach(() => {
  vi.useFakeTimers();
  browserControl.mockReset();
  useBrowserStore.setState({ sessions: {} });
  const handleEvent = useBrowserStore.getState().handleEvent;
  handleEvent({
    event: 'browser_frame',
    chat_id: 'chat-1',
    browser_session_id: 'chat-1',
    backend: 'playwright_mcp',
    image_base64: 'frame',
    mime_type: 'image/jpeg',
    captured_at: 1,
  });
  handleEvent({
    event: 'browser_status',
    chat_id: 'chat-1',
    browser_session_id: 'chat-1',
    backend: 'playwright_mcp',
    status: 'running',
    timestamp: 1,
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  vi.useRealTimers();
});

describe('BrowserPanel mirror refresh', () => {
  it('polls only while the user has taken control', () => {
    renderPanel();

    act(() => vi.advanceTimersByTime(9_000));
    expect(browserControl).not.toHaveBeenCalled();

    act(() => useBrowserStore.getState().handleEvent({
      event: 'browser_status',
      chat_id: 'chat-1',
      browser_session_id: 'chat-1',
      backend: 'playwright_mcp',
      status: 'user_control',
      timestamp: 2,
    }));
    act(() => vi.advanceTimersByTime(3_000));

    expect(browserControl).toHaveBeenCalledTimes(1);
    expect(browserControl).toHaveBeenCalledWith('chat-1', 'capture');
  });

  it('keeps the close control below the title-bar drag region and closes after stop', () => {
    act(() => useBrowserStore.getState().handleEvent({
      event: 'browser_status',
      chat_id: 'chat-1',
      browser_session_id: 'chat-1',
      backend: 'playwright_mcp',
      status: 'stopped',
      timestamp: 2,
    }));
    renderPanel();

    const header = container?.querySelector('header');
    const closeButton = container?.querySelector(
      `button[aria-label="${getI18n().panel.browserClose}"]`,
    );
    expect(header?.classList.contains(isWindows() ? 'mt-12' : 'mt-7')).toBe(true);
    expect(closeButton).not.toBeNull();

    act(() => closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(useBrowserStore.getState().sessions['chat-1']).toMatchObject({
      open: false,
      dismissed: true,
      status: 'stopped',
    });
  });
});
