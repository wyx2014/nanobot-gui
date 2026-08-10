import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchSessionRuntimeSnapshot,
  fetchThreadResource,
  fetchWebuiThread,
} from '@/core/api';
import type {
  ThreadResource,
  ThreadRuntimeSnapshot,
  UIMessage,
  WebuiThreadPersistedPayload,
} from '@/core/types';
import { loadConversationHistory } from './conversationHistory';

vi.mock('@/core/api', () => ({
  fetchSessionRuntimeSnapshot: vi.fn(),
  fetchThreadResource: vi.fn(),
  fetchWebuiThread: vi.fn(),
}));

const userMessage: UIMessage = {
  id: 'user-1',
  role: 'user',
  content: '帮我分析下 特变电工 A股',
  createdAt: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('loadConversationHistory', () => {
  it('uses the canonical Thread Resource when available', async () => {
    const resource = {
      messages: [userMessage],
    } as ThreadResource;
    vi.mocked(fetchThreadResource).mockResolvedValue(resource);

    const result = await loadConversationHistory(
      'token',
      'websocket:chat-a',
      'http://127.0.0.1:8900',
      200,
    );

    expect(result).toMatchObject({
      source: 'thread-resource',
      resource,
      messages: [userMessage],
    });
    expect(fetchWebuiThread).not.toHaveBeenCalled();
  });

  it('falls back to WebUI history when the canonical endpoint fails', async () => {
    const snapshot = {
      session_key: 'websocket:chat-a',
    } as ThreadRuntimeSnapshot;
    vi.mocked(fetchThreadResource).mockRejectedValue(new Error('HTTP 500'));
    vi.mocked(fetchWebuiThread).mockResolvedValue({
      messages: [userMessage],
    } as WebuiThreadPersistedPayload);
    vi.mocked(fetchSessionRuntimeSnapshot).mockResolvedValue(snapshot);

    const result = await loadConversationHistory(
      'token',
      'websocket:chat-a',
      'http://127.0.0.1:8900',
      200,
    );

    expect(result).toMatchObject({
      source: 'webui-thread',
      resource: null,
      runtimeSnapshot: snapshot,
      messages: [userMessage],
    });
  });

  it('keeps transcript fallback usable when runtime snapshot loading fails', async () => {
    vi.mocked(fetchThreadResource).mockRejectedValue(new Error('HTTP 500'));
    vi.mocked(fetchWebuiThread).mockResolvedValue({
      messages: [userMessage],
    } as WebuiThreadPersistedPayload);
    vi.mocked(fetchSessionRuntimeSnapshot).mockRejectedValue(new Error('runtime failed'));

    const result = await loadConversationHistory(
      'token',
      'websocket:chat-a',
      'http://127.0.0.1:8900',
      200,
    );

    expect(result.runtimeSnapshot).toBeNull();
    expect(result.messages).toEqual([userMessage]);
  });

  it('reports a real load failure instead of returning an empty conversation', async () => {
    vi.mocked(fetchThreadResource).mockRejectedValue(new Error('canonical failed'));
    vi.mocked(fetchWebuiThread).mockRejectedValue(new Error('fallback failed'));

    await expect(loadConversationHistory(
      'token',
      'websocket:chat-a',
      'http://127.0.0.1:8900',
      200,
    )).rejects.toThrow('canonical failed');
  });
});
