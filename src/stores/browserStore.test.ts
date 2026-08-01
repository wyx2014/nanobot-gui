import { beforeEach, describe, expect, it } from 'vitest';

import { useBrowserStore } from './browserStore';

describe('browserStore', () => {
  beforeEach(() => {
    useBrowserStore.setState({ sessions: {} });
  });

  it('opens on the first frame and remains closed after a user dismissal', () => {
    const store = useBrowserStore.getState();
    store.handleEvent({
      event: 'browser_frame',
      chat_id: 'chat-1',
      browser_session_id: 'chat-1',
      backend: 'playwright_mcp',
      image_base64: 'frame-one',
      mime_type: 'image/jpeg',
      captured_at: 1,
    });
    expect(useBrowserStore.getState().sessions['chat-1'].open).toBe(true);

    useBrowserStore.getState().closePanel('chat-1');
    useBrowserStore.getState().handleEvent({
      event: 'browser_frame',
      chat_id: 'chat-1',
      browser_session_id: 'chat-1',
      backend: 'playwright_mcp',
      image_base64: 'frame-two',
      mime_type: 'image/jpeg',
      captured_at: 2,
    });

    expect(useBrowserStore.getState().sessions['chat-1']).toMatchObject({
      open: false,
      dismissed: true,
      frame: { imageBase64: 'frame-two' },
    });
  });

  it('keeps browser state isolated by chat id', () => {
    const handleEvent = useBrowserStore.getState().handleEvent;
    handleEvent({
      event: 'browser_status',
      chat_id: 'chat-a',
      browser_session_id: 'chat-a',
      backend: 'playwright_mcp',
      status: 'running',
      timestamp: 1,
    });
    handleEvent({
      event: 'browser_status',
      chat_id: 'chat-b',
      browser_session_id: 'chat-b',
      backend: 'playwright_mcp',
      status: 'user_control',
      timestamp: 2,
    });

    expect(useBrowserStore.getState().sessions['chat-a'].status).toBe('running');
    expect(useBrowserStore.getState().sessions['chat-b'].status).toBe('user_control');
  });
});

