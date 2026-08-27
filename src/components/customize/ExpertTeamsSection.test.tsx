import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import ExpertTeamsSection from './ExpertTeamsSection';

const mocks = vi.hoisted(() => ({
  fetchExpertTeams: vi.fn(),
  fetchExpertTeamDetail: vi.fn(),
}));

vi.mock('@/core/api', async () => {
  const actual = await vi.importActual<typeof import('@/core/api')>('@/core/api');
  return {
    ...actual,
    fetchExpertTeams: mocks.fetchExpertTeams,
    fetchExpertTeamDetail: mocks.fetchExpertTeamDetail,
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
      workflow_count: 18,
      tags: ['投研'],
      requested_concurrency: 3,
    }],
  });
  mocks.fetchExpertTeamDetail.mockResolvedValue({
    id: 'asset-research-team',
    name: '资产投研团队 · 个股研究',
    description: '多角色协作完成单股投资研究',
    version: '1.0.0',
    enabled: true,
    available: true,
    member_count: 5,
    workflow_count: 18,
    tags: ['投研'],
    requested_concurrency: 3,
    members: [],
    workflows: [
      { id: 'investment-team', name: '团队深度投研', mode: 'team', featured: true },
      { id: 'earnings-team', name: '团队财报复盘', mode: 'team', featured: true },
      { id: 'investment-research', name: '公司深度研究', mode: 'lead', featured: true },
      { id: 'industry-research', name: '行业深度研究', mode: 'lead', featured: true },
      { id: 'private-company-research', name: '非上市公司研究', mode: 'lead', featured: true },
      { id: 'portfolio-review', name: '投资组合复盘', mode: 'lead', featured: true },
    ],
    optional_dependencies: [],
    source_available: true,
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
  it('presents the runtime entry as one fixed workflow', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<ExpertTeamsSection />);
    });

    expect(container.textContent).toMatch(/1 套固定工作流|1 fixed workflow/);
    expect(container.textContent).not.toMatch(/18 个工作流|18 workflows/);
  });

  it('shows only the runtime entry in details when an older gateway returns featured skills', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<ExpertTeamsSection />);
    });

    const viewTeamButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => /查看团队|View Team/.test(button.textContent ?? ''));
    await act(async () => {
      viewTeamButton?.click();
    });

    const workflows = container.querySelectorAll('[data-expert-workflow]');
    expect(workflows).toHaveLength(1);
    expect(workflows[0]?.textContent).toContain('团队深度投研');
    expect(container.textContent).not.toContain('团队财报复盘');
  });

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
