import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/stores/chatStore';
import ChatInput from './ChatInput';

const mocks = vi.hoisted(() => ({
  fetchExpertTeams: vi.fn(),
  setExpertTeam: vi.fn(),
}));

vi.mock('@/core/nanobotClient', async () => {
  const actual = await vi.importActual<typeof import('@/core/nanobotClient')>('@/core/nanobotClient');
  return {
    ...actual,
    getNanobotClient: vi.fn().mockReturnValue({ setExpertTeam: mocks.setExpertTeam }),
    getNanobotStatus: vi.fn().mockResolvedValue({ ready: true, port: 8900, tokenSecret: 'secret' }),
    getNanobotToken: vi.fn().mockReturnValue('token'),
  };
});

vi.mock('@/core/api', async () => {
  const actual = await vi.importActual<typeof import('@/core/api')>('@/core/api');
  return {
    ...actual,
    fetchExpertTeams: mocks.fetchExpertTeams,
    listSlashCommands: vi.fn().mockResolvedValue([]),
    fetchCliApps: vi.fn().mockResolvedValue({ apps: [] }),
    fetchMcpPresets: vi.fn().mockResolvedValue({ presets: [] }),
  };
});

const investmentTeam = {
  id: 'asset-research',
  name: '资产投研团队',
  description: '多角色协作完成投资研究',
  version: '1.0.0',
  enabled: true,
  available: true,
  member_count: 5,
  workflow_count: 1,
  tags: ['投资'],
  requested_concurrency: 3,
};

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mocks.fetchExpertTeams.mockResolvedValue({ teams: [investmentTeam] });
  mocks.setExpertTeam.mockImplementation(async (_chatId, team) => team);
});

afterEach(() => {
  act(() => root?.unmount());
  useChatStore.setState({ activeConversationId: null, conversations: {} });
  container?.remove();
  container = undefined;
  root = undefined;
  vi.clearAllMocks();
});

async function renderChatInput(
  variant: 'welcome' | 'chat' = 'chat',
  onSend: Parameters<typeof ChatInput>[0]['onSend'] = () => true,
): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<ChatInput variant={variant} onSend={onSend} />);
  });
  return container;
}

async function openExpertTeamSubmenu(view: HTMLDivElement): Promise<HTMLElement> {
  const plusButton = view.querySelector('svg.lucide-plus')?.closest('button');
  expect(plusButton).not.toBeNull();
  act(() => plusButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

  const expertTeamItem = view.querySelector<HTMLElement>('[data-plus-menu-item="expert-team"]');
  const skillsItem = view.querySelector<HTMLElement>('[data-plus-menu-item="skills"]');
  expect(expertTeamItem).not.toBeNull();
  expect(skillsItem).not.toBeNull();
  expect(expertTeamItem!.textContent).toMatch(/专家团队|Expert teams/);
  expect(expertTeamItem!.textContent).not.toMatch(/加入专家团队|Add expert team/);
  expect(expertTeamItem!.compareDocumentPosition(skillsItem!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await act(async () => {
    expertTeamItem?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  return expertTeamItem as HTMLElement;
}

describe('ChatInput expert-team menu', () => {
  it('opens a right-side team list and binds the selection to the current conversation', async () => {
    const conversationId = useChatStore.getState().createConversation(null, { title: '当前会话' });
    const view = await renderChatInput();
    await openExpertTeamSubmenu(view);

    const teamButton = [...view.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('资产投研团队'));
    expect(teamButton).toBeDefined();

    await act(async () => teamButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(mocks.setExpertTeam).toHaveBeenCalledWith(conversationId, {
      id: 'asset-research',
      name: '资产投研团队',
      version: '1.0.0',
      member_count: 5,
    });

    expect(useChatStore.getState().conversations[conversationId].expertTeam).toEqual({
      id: 'asset-research',
      name: '资产投研团队',
      version: '1.0.0',
      member_count: 5,
    });
    expect(view.querySelector('[data-plus-menu-item="expert-team"]')).toBeNull();

    const selectedTeam = view.querySelector<HTMLButtonElement>('[data-selected-expert-team="asset-research"]');
    expect(selectedTeam?.textContent).toContain('资产投研团队');
    expect(selectedTeam?.querySelector('svg.lucide-users')).not.toBeNull();
    expect(selectedTeam?.querySelector('svg.lucide-x')).not.toBeNull();

    await act(async () => selectedTeam?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(mocks.setExpertTeam).toHaveBeenLastCalledWith(conversationId, null);
    expect(useChatStore.getState().conversations[conversationId].expertTeam).toBeNull();
    expect(view.querySelector('[data-selected-expert-team="asset-research"]')).toBeNull();
  });

  it('keeps the selected team visible until the gateway confirms unbinding', async () => {
    const conversationId = useChatStore.getState().createConversation(null, {
      title: '当前会话',
      expertTeam: {
        id: 'asset-research',
        name: '资产投研团队',
        version: '1.0.0',
        member_count: 5,
      },
    });
    let confirmUnbind: ((team: null) => void) | undefined;
    mocks.setExpertTeam.mockReturnValue(new Promise((resolve) => {
      confirmUnbind = resolve;
    }));
    const view = await renderChatInput();
    const selectedTeam = view.querySelector<HTMLButtonElement>('[data-selected-expert-team="asset-research"]');

    act(() => selectedTeam?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(useChatStore.getState().conversations[conversationId].expertTeam?.id).toBe('asset-research');
    expect(selectedTeam?.getAttribute('aria-busy')).toBe('true');

    await act(async () => confirmUnbind?.(null));
    expect(useChatStore.getState().conversations[conversationId].expertTeam).toBeNull();
    expect(view.querySelector('[data-selected-expert-team="asset-research"]')).toBeNull();
  });

  it('passes a selected team into the first message when no conversation exists yet', async () => {
    const onSend = vi.fn().mockReturnValue(true);
    useChatStore.setState({ pendingInput: '分析青岛啤酒' });
    const view = await renderChatInput('welcome', onSend);
    await openExpertTeamSubmenu(view);
    const teamButton = [...view.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('资产投研团队'));
    act(() => teamButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const startButton = [...view.querySelectorAll('button')]
      .find((button) => /^(开始|Start)$/.test(button.textContent?.trim() ?? ''));
    expect(view.querySelector('textarea')?.value).toBe('分析青岛啤酒');
    expect(startButton).toBeDefined();
    expect(startButton?.disabled).toBe(false);
    act(() => startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onSend).toHaveBeenCalledWith(
      '分析青岛啤酒',
      undefined,
      null,
      expect.objectContaining({
        expertTeam: {
          id: 'asset-research',
          name: '资产投研团队',
          version: '1.0.0',
          member_count: 5,
        },
      }),
    );
  });
});
