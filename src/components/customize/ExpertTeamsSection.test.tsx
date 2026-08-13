import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import ExpertTeamsSection from './ExpertTeamsSection';

const mocks = vi.hoisted(() => ({
  fetchExpertTeams: vi.fn(),
}));

vi.mock('@/core/api', async () => {
  const actual = await vi.importActual<typeof import('@/core/api')>('@/core/api');
  return {
    ...actual,
    fetchExpertTeams: mocks.fetchExpertTeams,
  };
});

vi.mock('@/core/nanobotClient', async () => {
  const actual = await vi.importActual<typeof import('@/core/nanobotClient')>('@/core/nanobotClient');
  return {
    ...actual,
    getNanobotStatus: vi.fn().mockResolvedValue({ ready: true, port: 8900 }),
    getNanobotToken: vi.fn().mockReturnValue('token'),
  };
});

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  useSettingsStore.setState({
    viewMode: 'toolbox',
    toolboxSearchQuery: '',
  });
  useChatStore.setState({
    conversations: {
      existing: {
        id: 'existing',
        title: '已有会话',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
        status: 'idle',
      },
    },
    activeConversationId: 'existing',
    conversationNavigationHistory: [],
    pendingExpertTeam: null,
  });
  mocks.fetchExpertTeams.mockResolvedValue({
    teams: [{
      id: 'asset-research-team',
      name: '资产投研团队 · 个股研究',
      description: '多角色协作完成单股投资研究',
      version: '1.0.0',
      enabled: true,
      available: true,
      member_count: 5,
      workflow_count: 1,
      tags: ['投研'],
      requested_concurrency: 3,
    }],
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  useChatStore.setState({
    conversations: {},
    activeConversationId: null,
    pendingExpertTeam: null,
  });
  vi.clearAllMocks();
});

describe('ExpertTeamsSection team selection', () => {
  it('returns to the welcome composer with the team selected without creating a session', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<ExpertTeamsSection />);
    });

    const useTeamButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => /使用团队|Use Team/.test(button.textContent ?? ''));
    expect(useTeamButton).toBeDefined();

    const onNewChat = vi.fn();
    window.addEventListener('nanobot-gui:new-chat', onNewChat);
    act(() => useTeamButton?.click());
    window.removeEventListener('nanobot-gui:new-chat', onNewChat);

    const state = useChatStore.getState();
    expect(Object.keys(state.conversations)).toEqual(['existing']);
    expect(state.activeConversationId).toBeNull();
    expect(state.pendingExpertTeam).toEqual({
      id: 'asset-research-team',
      name: '资产投研团队 · 个股研究',
      version: '1.0.0',
      member_count: 5,
    });
    expect(useSettingsStore.getState().viewMode).toBe('chat');
    expect(onNewChat).toHaveBeenCalledOnce();
  });
});
