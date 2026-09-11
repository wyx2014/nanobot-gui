import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/stores/chatStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { VoiceStreamError } from '@/core/nanobot-client';
import { fsBridge } from '@/lib/ipc-factory';
import ChatInput from './ChatInput';

const mocks = vi.hoisted(() => ({
  fetchExpertTeams: vi.fn(),
  fetchSkills: vi.fn(),
  fetchMcpPresets: vi.fn(),
  setExpertTeam: vi.fn(),
  setMcpPresets: vi.fn(),
  transcribeAudio: vi.fn(),
  startVoiceStream: vi.fn(),
  appendVoiceAudio: vi.fn(),
  stopVoiceStream: vi.fn(),
  cancelVoiceStream: vi.fn(),
  startPcmVoiceRecorder: vi.fn(),
  stopPcmVoiceRecorder: vi.fn(),
  cancelPcmVoiceRecorder: vi.fn(),
  requestMicrophoneAccess: vi.fn(),
  openMicrophoneSettings: vi.fn(),
  openFolderDialog: vi.fn(),
  listWorkspaceFiles: vi.fn(),
  switchGatewayTextModelDefault: vi.fn(),
}));

vi.mock('@/core/nanobotClient', async () => {
  const actual = await vi.importActual<typeof import('@/core/nanobotClient')>('@/core/nanobotClient');
  return {
    ...actual,
    getNanobotClient: vi.fn().mockReturnValue({
      setExpertTeam: mocks.setExpertTeam,
      setMcpPresets: mocks.setMcpPresets,
      transcribeAudio: mocks.transcribeAudio,
      startVoiceStream: mocks.startVoiceStream,
      appendVoiceAudio: mocks.appendVoiceAudio,
      stopVoiceStream: mocks.stopVoiceStream,
      cancelVoiceStream: mocks.cancelVoiceStream,
    }),
    getNanobotStatus: vi.fn().mockResolvedValue({ ready: true, port: 8900, tokenSecret: 'secret' }),
    getNanobotToken: vi.fn().mockReturnValue('token'),
    switchGatewayTextModelDefault: mocks.switchGatewayTextModelDefault,
  };
});

vi.mock('@/core/audio/pcmVoiceRecorder', () => ({
  startPcmVoiceRecorder: mocks.startPcmVoiceRecorder,
}));

vi.mock('@/lib/ipc-factory', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ipc-factory')>('@/lib/ipc-factory');
  return {
    ...actual,
    mediaBridge: {
      requestMicrophoneAccess: mocks.requestMicrophoneAccess,
      openMicrophoneSettings: mocks.openMicrophoneSettings,
    },
    dialogBridge: {
      open: mocks.openFolderDialog,
    },
    fsBridge: {
      ...actual.fsBridge,
      listWorkspaceFiles: mocks.listWorkspaceFiles,
    },
  };
});

vi.mock('@/core/api', async () => {
  const actual = await vi.importActual<typeof import('@/core/api')>('@/core/api');
  return {
    ...actual,
    fetchExpertTeams: mocks.fetchExpertTeams,
    fetchSkills: mocks.fetchSkills,
    listSlashCommands: vi.fn().mockResolvedValue([]),
    fetchCliApps: vi.fn().mockResolvedValue({ apps: [] }),
    fetchMcpPresets: mocks.fetchMcpPresets,
  };
});

const investmentTeam = {
  id: 'asset-research',
  name: '资产投研团队 · 个股研究',
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
  useDiscoveryStore.setState({ skills: [], agents: [], experts: [], isLoading: false });
  mocks.fetchSkills.mockResolvedValue({ skills: [], disabled: [], installed_count: 0 });
  useSettingsStore.setState({
    provider: 'qiniu',
    model: 'deepseek/deepseek-v3.2-251201',
    gatewayTextModels: [
      {
        presetName: 'qiniu-deepseek',
        provider: 'qiniu',
        model: 'deepseek/deepseek-v3.2-251201',
        label: 'DeepSeek V3.2',
      },
      {
        presetName: 'qiniu-kimi',
        provider: 'qiniu',
        model: 'moonshotai/kimi-k2.5',
        label: 'Kimi K2.5',
      },
    ],
    activeTextModelPreset: 'qiniu-deepseek',
    gatewayTextModelsHydrated: true,
    voiceInputAvailable: true,
    voiceMaxDurationSec: 120,
  });
  useWorkspaceStore.setState({
    currentPath: null,
    recentPaths: [],
    projects: [],
    projectsHydrated: true,
    projectNames: {},
    projectSkillBindings: {},
  });
  mocks.fetchExpertTeams.mockResolvedValue({ teams: [investmentTeam] });
  mocks.fetchMcpPresets.mockResolvedValue({
    presets: [{
      name: 'juyuan',
      display_name: '聚源金融数据',
      category: 'finance',
      description: '聚源金融数据',
      docs_url: '',
      transport: 'stdio',
      requires: '',
      note: '',
      install_supported: true,
      installed: true,
      configured: true,
      available: true,
      status: 'configured',
      required_fields: [],
      connection_summary: '已连接',
    }],
    installed_count: 1,
  });
  mocks.setExpertTeam.mockImplementation(async (_chatId, team) => team);
  mocks.setMcpPresets.mockImplementation(async (_chatId, presets) => presets);
  mocks.switchGatewayTextModelDefault.mockImplementation(async (presetName: string) => {
    const selected = useSettingsStore.getState().gatewayTextModels.find((model) => (
      model.presetName === presetName
    ));
    if (!selected) throw new Error('unknown model preset');
    useSettingsStore.setState({
      activeTextModelPreset: selected.presetName,
      model: selected.model,
    });
  });
  mocks.stopPcmVoiceRecorder.mockResolvedValue({
    dataUrl: 'data:audio/wav;base64,UklGRg==',
    durationMs: 1200,
    byteLength: 8,
  });
  mocks.startPcmVoiceRecorder.mockResolvedValue({
    stop: mocks.stopPcmVoiceRecorder,
    cancel: mocks.cancelPcmVoiceRecorder,
  });
  mocks.transcribeAudio.mockResolvedValue('这是一段语音输入');
  mocks.startVoiceStream.mockResolvedValue('batch');
  mocks.stopVoiceStream.mockResolvedValue('实时语音输入完成');
  mocks.requestMicrophoneAccess.mockResolvedValue({
    granted: true,
    status: 'granted',
  });
  mocks.openMicrophoneSettings.mockResolvedValue(true);
  mocks.openFolderDialog.mockResolvedValue(null);
  mocks.listWorkspaceFiles.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root?.unmount());
  useChatStore.setState({
    activeConversationId: null,
    conversations: {},
    pendingExpertTeam: null,
  });
  container?.remove();
  container = undefined;
  root = undefined;
  vi.clearAllMocks();
  localStorage.removeItem('nanobot.gui.composerDraft.v1:chat');
});

it('restores a presentation draft and sends its document binding', async () => {
  const presentation = { template_id: 'taiping-standard', document_id: 'document-001', name: '中国太平标准', sample_first: true };
  localStorage.setItem('nanobot.gui.composerDraft.v1:chat', JSON.stringify({ text: '生成年度报告', images: [], files: [], skills: [], cliApps: [], mcpPresets: [], presentation }));
  const onSend = vi.fn().mockReturnValue(true);
  const view = await renderChatInput('chat', onSend);
  expect(view.querySelector('[data-presentation-selection]')?.textContent).toContain('中国太平标准');
  await act(async () => view.querySelector<HTMLButtonElement>('[data-codex-send-button]')!.click());
  expect(onSend).toHaveBeenCalledWith('生成年度报告', undefined, undefined, expect.objectContaining({ presentation }));
});

async function renderChatInput(
  variant: 'welcome' | 'chat' = 'chat',
  onSend: Parameters<typeof ChatInput>[0]['onSend'] = () => true,
  props: Partial<Parameters<typeof ChatInput>[0]> = {},
): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<ChatInput variant={variant} onSend={onSend} {...props} />);
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

describe('ChatInput stop feedback', () => {
  it('shows a disabled spinner while the gateway is stopping the turn', async () => {
    const onStop = vi.fn();
    const view = await renderChatInput('chat', () => true, {
      isStreaming: true,
      isStopping: true,
      onStop,
    });

    const stopButton = view.querySelector<HTMLButtonElement>('[data-codex-stop]');
    expect(stopButton).not.toBeNull();
    expect(stopButton?.disabled).toBe(true);
    expect(stopButton?.getAttribute('aria-busy')).toBe('true');
    expect(stopButton?.querySelector('.animate-spin')).not.toBeNull();

    act(() => stopButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onStop).not.toHaveBeenCalled();
  });
});

describe('ChatInput welcome layout', () => {
  it('keeps the existing compact layout while exposing scoped dark-theme hooks', async () => {
    const view = await renderChatInput('welcome');
    const shell = view.querySelector<HTMLElement>('[data-welcome-composer-shell]');
    const projectSelector = shell?.querySelector<HTMLElement>('[data-welcome-project-selector]');
    const composer = shell?.querySelector<HTMLElement>('[data-welcome-composer-card]');
    const textarea = composer?.querySelector<HTMLTextAreaElement>('[data-welcome-composer-input]');
    const shortcuts = [...view.querySelectorAll<HTMLButtonElement>('[data-welcome-shortcut]')];

    expect(shell).not.toBeNull();
    expect(projectSelector).not.toBeNull();
    expect(composer).not.toBeNull();
    expect(Number(textarea?.rows)).toBe(2);
    expect(textarea?.className).toContain('min-h-[52px]');
    expect(shortcuts.map((button) => button.dataset.welcomeShortcut)).toEqual([
      'data-analysis',
      'office',
    ]);
    expect(shortcuts[0]?.textContent).toMatch(/数据分析|Data Analysis/);
    expect(shortcuts[1]?.textContent).toMatch(/综合办公|Office Work/);

    await act(async () => shortcuts[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(shortcuts[0]?.dataset.active).toBe('true');
    expect(view.querySelector('[data-welcome-shortcut-panel]')).not.toBeNull();
  });

  it('shares the dark composer surface with conversations without changing chat sizing', async () => {
    const view = await renderChatInput('chat');
    const shell = view.querySelector<HTMLElement>('[data-codex-composer-shell]');
    const composer = shell?.querySelector<HTMLElement>('[data-codex-composer-card]');
    const textarea = composer?.querySelector<HTMLTextAreaElement>('[data-codex-composer-input]');

    expect(shell?.dataset.composerVariant).toBe('chat');
    expect(shell?.hasAttribute('data-welcome-composer-shell')).toBe(false);
    expect(composer).not.toBeNull();
    expect(composer?.dataset.floatingComposer).toBe('true');
    expect(shell?.className).toContain('bg-transparent');
    expect(composer?.className).toContain('backdrop-blur-xl');
    expect(Number(textarea?.rows)).toBe(1);
    expect(textarea?.className).toContain('min-h-[28px]');
    expect(textarea?.style.overflowY).toBe('hidden');
    expect(view.querySelector('[data-codex-composer-toolbar]')).not.toBeNull();
    expect(view.querySelector('[data-codex-model-picker]')).not.toBeNull();
    const sendButton = view.querySelector<HTMLButtonElement>('[data-codex-send-button]');
    expect(sendButton?.classList.contains('composer-send-button')).toBe(true);
    expect(sendButton?.getAttribute('aria-label')).toMatch(/发送消息|Send message/);
    expect(sendButton?.querySelector('svg.lucide-arrow-up')).not.toBeNull();
    const projectSelector = view.querySelector<HTMLElement>('[data-codex-project-selector]');
    expect(projectSelector?.dataset.composerProjectSelectorPlacement).toBe('inside');
    expect(composer?.contains(projectSelector ?? null)).toBe(true);
  });

  it('shows the current model on the welcome composer and supports switching it', async () => {
    useSettingsStore.setState({
      provider: 'qiniu',
      model: 'deepseek/deepseek-v3.2-251201',
    });
    const view = await renderChatInput('welcome');
    const picker = view.querySelector<HTMLButtonElement>(
      '[data-welcome-composer-toolbar] [data-codex-model-picker]',
    );

    expect(picker).not.toBeNull();
    expect(picker?.textContent).toBe('deepseek-v3.2-251201');
    expect(picker?.title).toBe('deepseek/deepseek-v3.2-251201');

    act(() => picker?.click());
    const kimi = [...view.querySelectorAll<HTMLButtonElement>('[data-codex-model-menu] button')]
      .find((button) => button.textContent?.includes('kimi-k2.5'));
    expect(kimi).toBeDefined();
    expect(kimi?.textContent).toBe('kimi-k2.5');
    expect(kimi?.querySelector('span')?.title).toBe('moonshotai/kimi-k2.5');

    await act(async () => kimi?.click());
    expect(mocks.switchGatewayTextModelDefault).toHaveBeenCalledWith('qiniu-kimi');
    expect(useSettingsStore.getState().model).toBe('moonshotai/kimi-k2.5');
    expect(view.querySelector('[data-codex-model-menu]')).toBeNull();
  });

  it('hides the project selector for scheduled-task conversations', async () => {
    useChatStore.setState({
      activeConversationId: 'scheduled-conversation',
      conversations: {
        'scheduled-conversation': {
          id: 'scheduled-conversation',
          title: '每日 AI 新闻推送',
          messages: [],
          createdAt: 1,
          updatedAt: 1,
          status: 'idle',
          scheduledTaskId: 'daily-ai-news',
        },
      },
    });

    const view = await renderChatInput('chat');

    expect(view.querySelector('[data-codex-project-selector]')).toBeNull();
  });

  it('does not resurrect a removed workspace from stale cached conversations', async () => {
    useChatStore.setState({
      activeConversationId: null,
      conversations: {
        stale: {
          id: 'stale',
          title: '旧会话',
          messages: [],
          createdAt: 1,
          updatedAt: 1,
          status: 'idle',
          workspacePath: 'C:\\Users\\test\\nanobot-workdir',
        },
      },
    });
    const view = await renderChatInput('welcome');
    const trigger = view.querySelector<HTMLButtonElement>('[data-welcome-project-selector] button');

    act(() => trigger?.click());

    const popover = view.querySelector<HTMLElement>('[data-workspace-selector-popover]');
    expect(popover?.dataset.workspaceSelectorEmpty).toBe('true');
    expect(popover?.textContent).not.toContain('nanobot-workdir');
  });

  it('uses only the final folder name when selecting a Windows workspace', async () => {
    const windowsPath = 'C:\\Users\\1\\Documents\\TPCowork Projects\\123123';
    const onWorkspaceScopeChange = vi.fn();
    mocks.openFolderDialog.mockResolvedValue(windowsPath);
    const view = await renderChatInput('welcome', () => true, { onWorkspaceScopeChange });
    const trigger = view.querySelector<HTMLButtonElement>('[data-welcome-project-selector] button');

    act(() => trigger?.click());

    const newWorkspaceButton = [...view.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => /新建工作空间|New workspace/.test(button.textContent ?? ''));
    expect(newWorkspaceButton).toBeDefined();
    act(() => newWorkspaceButton?.click());

    const existingProjectButton = [...view.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => /使用现有项目|Use existing project/.test(button.textContent ?? ''));
    expect(existingProjectButton).toBeDefined();
    await act(async () => existingProjectButton?.click());

    expect(mocks.openFolderDialog).toHaveBeenCalledOnce();
    expect(onWorkspaceScopeChange).toHaveBeenCalledWith(expect.objectContaining({
      project_path: windowsPath,
      project_name: '123123',
    }));
  });
});

describe('ChatInput expert-team menu', () => {
  it('renders a team preselected by the toolbox without creating a conversation', async () => {
    useChatStore.getState().startNewConversation({
      expertTeam: {
        id: 'asset-research',
        name: '资产投研团队 · 个股研究',
        version: '1.0.0',
        member_count: 5,
      },
    });

    const view = await renderChatInput('welcome');

    expect(useChatStore.getState().activeConversationId).toBeNull();
    expect(Object.keys(useChatStore.getState().conversations)).toHaveLength(0);
    expect(view.querySelector('[data-selected-expert-team="asset-research"]')?.textContent)
      .toContain('资产投研团队 · 个股研究');
    expect(document.activeElement).toBe(view.querySelector('textarea'));
  });

  it('opens a right-side team list and binds the selection to the current conversation', async () => {
    const conversationId = useChatStore.getState().createConversation(null, { title: '当前会话' });
    const view = await renderChatInput();
    await openExpertTeamSubmenu(view);

    const teamButton = [...view.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('资产投研团队 · 个股研究'));
    expect(teamButton).toBeDefined();
    expect(teamButton?.querySelector('[data-expert-team-icon="asset-research"]')).not.toBeNull();

    await act(async () => teamButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(mocks.setExpertTeam).toHaveBeenCalledWith(conversationId, {
      id: 'asset-research',
      name: '资产投研团队 · 个股研究',
      version: '1.0.0',
      member_count: 5,
    });

    expect(useChatStore.getState().conversations[conversationId].expertTeam).toEqual({
      id: 'asset-research',
      name: '资产投研团队 · 个股研究',
      version: '1.0.0',
      member_count: 5,
    });
    expect(view.querySelector('[data-plus-menu-item="expert-team"]')).toBeNull();

    const selectedTeam = view.querySelector<HTMLButtonElement>('[data-selected-expert-team="asset-research"]');
    expect(selectedTeam?.textContent).toContain('资产投研团队 · 个股研究');
    expect(selectedTeam?.querySelector('svg.lucide-chart-no-axes-combined')).not.toBeNull();
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
        name: '资产投研团队 · 个股研究',
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
      .find((button) => button.textContent?.includes('资产投研团队 · 个股研究'));
    act(() => teamButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const startButton = view.querySelector<HTMLButtonElement>('[data-welcome-submit]');
    expect(view.querySelector('textarea')?.value).toBe('分析青岛啤酒');
    expect(startButton).not.toBeNull();
    expect(startButton?.classList.contains('composer-send-button')).toBe(true);
    expect(startButton?.getAttribute('aria-label')).toMatch(/发送消息|Send message/);
    expect(startButton?.querySelector('svg.lucide-arrow-up')).not.toBeNull();
    expect(startButton?.disabled).toBe(false);
    act(() => startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onSend).toHaveBeenCalledWith(
      '分析青岛啤酒',
      undefined,
      null,
      expect.objectContaining({
        expertTeam: {
          id: 'asset-research',
          name: '资产投研团队 · 个股研究',
          version: '1.0.0',
          member_count: 5,
        },
      }),
    );
  });
});

describe('ChatInput voice input', () => {
  it('hides the microphone when no voice service is configured', async () => {
    useSettingsStore.setState({ voiceInputAvailable: false });

    const view = await renderChatInput();

    expect(view.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')).toBeNull();
    expect(mocks.requestMicrophoneAccess).not.toHaveBeenCalled();
  });

  it('records, transcribes, and inserts text without sending the message', async () => {
    const onSend = vi.fn(() => true);
    const view = await renderChatInput('chat', onSend);
    const startButton = view.querySelector<HTMLButtonElement>(
      'button[aria-label="语音输入"]',
    );

    expect(startButton).not.toBeNull();
    await act(async () => startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const stopButton = view.querySelector<HTMLButtonElement>('button[aria-label="结束录音"]');
    expect(stopButton).not.toBeNull();
    await act(async () => stopButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(mocks.transcribeAudio).toHaveBeenCalledWith(
      'data:audio/wav;base64,UklGRg==',
      1200,
    );
    expect(view.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(
      '这是一段语音输入',
    );
    expect(onSend).not.toHaveBeenCalled();
  });

  it('actively requests macOS permission before opening the recorder', async () => {
    const view = await renderChatInput();
    const startButton = view.querySelector<HTMLButtonElement>(
      'button[aria-label="语音输入"]',
    );

    await act(async () => startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(mocks.requestMicrophoneAccess).toHaveBeenCalledOnce();
    expect(mocks.startPcmVoiceRecorder).toHaveBeenCalledOnce();
    expect(
      mocks.requestMicrophoneAccess.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.startPcmVoiceRecorder.mock.invocationCallOrder[0]);
  });

  it('renders realtime partial text and commits the final transcript', async () => {
    let callbacks: {
      onPartial?: (text: string, stable: boolean) => void;
    } | undefined;
    mocks.startVoiceStream.mockImplementationOnce(async (_streamId, nextCallbacks) => {
      callbacks = nextCallbacks;
      return 'realtime';
    });
    const view = await renderChatInput();
    const startButton = view.querySelector<HTMLButtonElement>(
      'button[aria-label="语音输入"]',
    );

    await act(async () => startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => callbacks?.onPartial?.('正在实时识别', false));
    expect(view.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('正在实时识别');

    const stopButton = view.querySelector<HTMLButtonElement>('button[aria-label="结束录音"]');
    await act(async () => stopButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(mocks.stopVoiceStream).toHaveBeenCalledOnce();
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(view.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('实时语音输入完成');
  });

  it('falls back to the complete recording when realtime ASR is empty on first use', async () => {
    let callbacks: {
      onError?: (error: VoiceStreamError) => void;
    } | undefined;
    mocks.startVoiceStream.mockImplementationOnce(async (_streamId, nextCallbacks) => {
      callbacks = nextCallbacks;
      return 'realtime';
    });
    mocks.stopVoiceStream.mockImplementationOnce(async () => {
      const error = new VoiceStreamError('empty');
      callbacks?.onError?.(error);
      throw error;
    });
    mocks.transcribeAudio.mockResolvedValueOnce('首次录音批量识别成功');
    const view = await renderChatInput();
    const startButton = view.querySelector<HTMLButtonElement>(
      'button[aria-label="语音输入"]',
    );

    await act(async () => startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const stopButton = view.querySelector<HTMLButtonElement>('button[aria-label="结束录音"]');
    await act(async () => stopButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(mocks.stopVoiceStream).toHaveBeenCalledOnce();
    expect(mocks.transcribeAudio).toHaveBeenCalledWith(
      'data:audio/wav;base64,UklGRg==',
      1200,
    );
    expect(view.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(
      '首次录音批量识别成功',
    );
  });

  it('stops the microphone and realtime stream when visible speech is sent directly', async () => {
    let callbacks: {
      onPartial?: (text: string, stable: boolean) => void;
    } | undefined;
    mocks.startVoiceStream.mockImplementationOnce(async (_streamId, nextCallbacks) => {
      callbacks = nextCallbacks;
      return 'realtime';
    });
    const onSend = vi.fn(() => true);
    const view = await renderChatInput('chat', onSend);
    const startButton = view.querySelector<HTMLButtonElement>(
      'button[aria-label="语音输入"]',
    );

    await act(async () => startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => callbacks?.onPartial?.('把这段语音直接发送', false));
    const sendButton = view.querySelector('svg.lucide-arrow-up')?.closest('button');
    expect(sendButton).not.toBeNull();

    act(() => sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onSend).toHaveBeenCalledWith(
      '把这段语音直接发送',
      undefined,
      undefined,
      expect.any(Object),
    );
    expect(mocks.cancelPcmVoiceRecorder).toHaveBeenCalledOnce();
    expect(mocks.cancelVoiceStream).toHaveBeenCalledOnce();
    expect(mocks.stopVoiceStream).not.toHaveBeenCalled();
    expect(view.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')).not.toBeNull();
    expect(view.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
  });

  it('opens macOS microphone settings after a previous denial', async () => {
    mocks.requestMicrophoneAccess.mockResolvedValueOnce({
      granted: false,
      status: 'denied',
    });
    const view = await renderChatInput();
    const startButton = view.querySelector<HTMLButtonElement>(
      'button[aria-label="语音输入"]',
    );

    await act(async () => startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(mocks.openMicrophoneSettings).toHaveBeenCalledOnce();
    expect(mocks.startPcmVoiceRecorder).not.toHaveBeenCalled();
  });
});

describe('ChatInput versioned skills', () => {
  it('refreshes copied skills when opening the picker and sends the complete name', async () => {
    const onSend = vi.fn().mockReturnValue(true);
    const view = await renderChatInput('chat', onSend);
    expect(useDiscoveryStore.getState().skills).toEqual([]);
    mocks.fetchSkills.mockResolvedValue({
      skills: [{
        name: 'libai-1.0.4', description: '润色专家', source: 'workspace',
        enabled: true, available: true, user_invocable: true, tags: [],
      }],
      disabled: [], installed_count: 1,
    });

    await act(async () => view.querySelector('svg.lucide-plus')?.closest('button')?.click());
    await act(async () => view.querySelector('[data-plus-menu-item="skills"]')
      ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    const skillButton = [...view.querySelectorAll<HTMLButtonElement>('[data-plus-menu-item="skills"] button')]
      .find((button) => button.textContent?.includes('/libai-1.0.4'));
    expect(skillButton).toBeDefined();
    expect(mocks.fetchSkills).toHaveBeenCalledWith('token', 'http://127.0.0.1:8900');
    await act(async () => skillButton!.click());

    const textarea = view.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '润色这段文字');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => view.querySelector<HTMLButtonElement>('[data-codex-send-button]')!.click());
    expect(onSend).toHaveBeenCalledWith('润色这段文字', undefined, undefined, expect.objectContaining({
      skillScope: { project_bound_user_skills: [], explicit_skills: ['libai-1.0.4'] },
    }));
  });
});

describe('ChatInput workspace mentions and capabilities', () => {
  it('indexes files in the default workspace even though it is hidden as a project', async () => {
    useChatStore.getState().createConversation('/Users/test/workspace', { title: '默认工作空间会话' });
    await renderChatInput();

    await vi.waitFor(() => expect(mocks.listWorkspaceFiles).toHaveBeenCalledWith('/Users/test/workspace'));
  });

  it('finds a workspace file with @, preserves the prompt, and sends the existing file context', async () => {
    const conversationId = useChatStore.getState().createConversation('/Users/test/quarterly-review', { title: '工作空间会话' });
    expect(useChatStore.getState().conversations[conversationId].workspacePath).toBe('/Users/test/quarterly-review');
    expect(fsBridge.listWorkspaceFiles).toBe(mocks.listWorkspaceFiles);
    mocks.listWorkspaceFiles.mockResolvedValueOnce([
      {
        kind: 'file',
        name: 'quarterly.xlsx',
        path: '/Users/test/quarterly-review/reports/quarterly.xlsx',
        relativePath: 'reports/quarterly.xlsx',
      },
      {
        kind: 'file',
        name: 'notes.md',
        path: '/workspace/notes.md',
        relativePath: 'notes.md',
      },
    ]);
    const onSend = vi.fn().mockReturnValue(true);
    const view = await renderChatInput('chat', onSend);
    await vi.waitFor(() => expect(mocks.listWorkspaceFiles).toHaveBeenCalledWith('/Users/test/quarterly-review'));

    const textarea = view.querySelector<HTMLTextAreaElement>('textarea')!;
    const prompt = '请总结 @quarter';
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, prompt);
      textarea.setSelectionRange(prompt.length, prompt.length);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const popup = view.querySelector<HTMLElement>('[data-testid="composer-suggestions"]');
    expect(popup?.textContent).toContain('工作空间文件');
    expect(popup?.textContent).toContain('reports/quarterly.xlsx');
    expect(popup?.querySelector('[data-suggestion-kind="file"]')?.textContent).toContain('文件');
    expect(popup?.textContent).not.toContain('notes.md');

    await act(async () => {
      popup?.querySelector<HTMLButtonElement>('[data-suggestion-kind="file"]')?.click();
    });

    expect(textarea.value).toBe('请总结 ');
    expect(view.textContent).toContain('reports/quarterly.xlsx');
    expect(view.querySelector('[data-local-path-kind="file"] [data-path-icon="spreadsheet"]')).not.toBeNull();
    await act(async () => view.querySelector<HTMLButtonElement>('[data-codex-send-button]')!.click());
    expect(onSend).toHaveBeenCalledWith(
      expect.stringContaining('- [file] reports/quarterly.xlsx: /Users/test/quarterly-review/reports/quarterly.xlsx\n请总结'),
      undefined,
      undefined,
      expect.any(Object),
    );
  });

  it('finds folders with @ and keeps the folder type visible and structured', async () => {
    useChatStore.getState().createConversation('/Users/test/quarterly-review', { title: '工作空间会话' });
    mocks.listWorkspaceFiles.mockResolvedValueOnce([
      {
        kind: 'folder',
        name: 'reports',
        path: '/Users/test/quarterly-review/reports',
        relativePath: 'reports',
      },
      {
        kind: 'file',
        name: 'report.md',
        path: '/Users/test/quarterly-review/report.md',
        relativePath: 'report.md',
      },
    ]);
    const onSend = vi.fn().mockReturnValue(true);
    const view = await renderChatInput('chat', onSend);
    await vi.waitFor(() => expect(mocks.listWorkspaceFiles).toHaveBeenCalledWith('/Users/test/quarterly-review'));

    const textarea = view.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '@reports');
      textarea.setSelectionRange(8, 8);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const folderSuggestion = view.querySelector<HTMLButtonElement>('[data-suggestion-kind="folder"]');
    expect(folderSuggestion?.textContent).toContain('reports');
    expect(folderSuggestion?.textContent).toContain('文件夹');
    await act(async () => folderSuggestion?.click());

    const folderChip = view.querySelector<HTMLElement>('[data-local-path-kind="folder"]');
    expect(folderChip?.textContent).toContain('reports');
    expect(folderChip?.textContent).toContain('文件夹');
    expect(folderChip?.querySelector('[data-path-icon="folder"]')).not.toBeNull();
    await act(async () => view.querySelector<HTMLButtonElement>('[data-codex-send-button]')!.click());
    expect(onSend).toHaveBeenCalledWith(
      expect.stringContaining('- [folder] reports: /Users/test/quarterly-review/reports'),
      undefined,
      undefined,
      expect.any(Object),
    );
  });

  it('uses file-type icons while keeping every path label out of the skill category', async () => {
    useChatStore.getState().createConversation('/Users/test/design-assets', { title: '素材工作空间' });
    mocks.listWorkspaceFiles.mockResolvedValueOnce([
      { kind: 'folder', name: 'assets', path: '/Users/test/design-assets/assets', relativePath: 'assets' },
      { kind: 'file', name: 'cover.png', path: '/Users/test/design-assets/cover.png', relativePath: 'cover.png' },
      { kind: 'file', name: 'roadshow.pptx', path: '/Users/test/design-assets/roadshow.pptx', relativePath: 'roadshow.pptx' },
      { kind: 'file', name: 'brief.docx', path: '/Users/test/design-assets/brief.docx', relativePath: 'brief.docx' },
      { kind: 'file', name: 'notes.txt', path: '/Users/test/design-assets/notes.txt', relativePath: 'notes.txt' },
      // Covers a renderer hot reload while the Electron main process is still
      // returning the pre-kind file entry shape.
      { name: 'legacy.pdf', path: '/Users/test/design-assets/legacy.pdf', relativePath: 'legacy.pdf' },
    ]);
    const view = await renderChatInput();
    const textarea = view.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '@');
      textarea.setSelectionRange(1, 1);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await vi.waitFor(() => expect(view.querySelector('[data-path-icon="image"]')).not.toBeNull());
    expect(view.querySelector('[data-path-icon="folder"]')).not.toBeNull();
    expect(view.querySelector('[data-path-icon="presentation"]')).not.toBeNull();
    expect(view.querySelector('[data-path-icon="document"]')).not.toBeNull();
    expect(view.querySelector('[data-path-icon="text"]')).not.toBeNull();
    expect(view.querySelector('[data-path-icon="pdf"]')).not.toBeNull();
    expect(view.querySelector('[data-suggestion-kind="folder"]')?.textContent).toContain('文件夹');
    [...view.querySelectorAll('[data-suggestion-kind="file"]')].forEach((item) => {
      expect(item.textContent).toContain('文件');
      expect(item.textContent).not.toContain('技能');
    });
  });

  it('shows skills and connectors together under / and keeps connectors free of the @ prefix', async () => {
    mocks.fetchSkills.mockResolvedValue({
      skills: [{
        name: 'writer', description: '写作助手', source: 'builtin',
        enabled: true, available: true, user_invocable: true, tags: [],
      }],
      disabled: [], installed_count: 1,
    });
    const view = await renderChatInput();
    const textarea = view.querySelector<HTMLTextAreaElement>('textarea')!;
    const prompt = '/';
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, prompt);
      textarea.setSelectionRange(prompt.length, prompt.length);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await vi.waitFor(() => expect(view.querySelector('[data-suggestion-kind="skill"]')).not.toBeNull());

    const popup = view.querySelector<HTMLElement>('[data-testid="composer-suggestions"]');
    expect(popup?.textContent).toContain('技能与连接器');
    expect(popup?.querySelector('[data-suggestion-kind="skill"]')?.textContent).toContain('/writer');
    expect(popup?.querySelector('[data-suggestion-kind="mcp"]')?.textContent).toContain('聚源金融数据');

    await act(async () => {
      popup?.querySelector<HTMLButtonElement>('[data-suggestion-kind="mcp"]')?.click();
    });
    const connectorChip = view.querySelector<HTMLButtonElement>('[data-selected-mcp-preset="juyuan"]');
    expect(connectorChip?.textContent).toContain('聚源金融数据');
    expect(connectorChip?.textContent).not.toContain('@');
    expect(connectorChip?.querySelector('svg.lucide-puzzle')).not.toBeNull();
    expect(textarea.value).toBe('');
  });
});

describe('ChatInput connector messages', () => {
  it('sends the MCP connector as metadata without adding @name to the message body', async () => {
    const onSend = vi.fn().mockReturnValue(true);
    const view = await renderChatInput('chat', onSend);

    const plusButton = view.querySelector('svg.lucide-plus')?.closest('button');
    act(() => plusButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const connectorItem = view.querySelector<HTMLElement>('[data-plus-menu-item="connector"]');
    await act(async () => {
      connectorItem?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    const connectorButton = [...view.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('聚源金融数据'));
    expect(connectorButton).toBeDefined();
    act(() => connectorButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const textarea = view.querySelector('textarea');
    await act(async () => {
      if (!textarea) return;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '帮我分析下啤酒股票');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(textarea?.value).toBe('帮我分析下啤酒股票');

    const sendButton = view.querySelector('svg.lucide-arrow-up')?.closest('button');
    expect(sendButton).not.toBeNull();
    act(() => sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onSend).toHaveBeenCalledWith(
      '帮我分析下啤酒股票',
      undefined,
      undefined,
      expect.objectContaining({
        mcpPresets: [expect.objectContaining({ name: 'juyuan' })],
      }),
    );
  });

  it('keeps a connector visible for the conversation and removes it through the gateway', async () => {
    const conversationId = useChatStore.getState().createConversation(null, { title: '啤酒研究' });
    useChatStore.getState().setConversationMcpPresets(conversationId, [{
      name: 'juyuan',
      display_name: '聚源金融数据',
      configured: true,
    }]);
    const view = await renderChatInput('chat');
    const boundConnector = view.querySelector<HTMLButtonElement>(
      '[data-bound-mcp-presets] button',
    );

    expect(boundConnector?.textContent).toContain('聚源金融数据');
    expect(boundConnector?.textContent).not.toContain('本会话');
    expect(boundConnector?.closest('[data-codex-composer-toolbar]')).not.toBeNull();
    expect(boundConnector?.querySelector('svg.lucide-puzzle')).not.toBeNull();
    expect(boundConnector?.querySelector('svg.lucide-x')).not.toBeNull();

    await act(async () => {
      boundConnector?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mocks.setMcpPresets).toHaveBeenCalledWith(conversationId, []);
    expect(useChatStore.getState().conversations[conversationId].mcpPresets).toEqual([]);
    expect(view.querySelector('[data-bound-mcp-presets]')).toBeNull();
  });
});
