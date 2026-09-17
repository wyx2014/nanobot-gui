import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStore } from '@/stores/chatStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useToastStore } from '@/stores/toastStore';
import { useOfficeGuideStore } from '@/stores/officeGuideStore';
import { VoiceStreamError } from '@/core/nanobot-client';
import { fsBridge } from '@/lib/ipc-factory';
import type { McpPresetInfo, NanobotSkillInfo } from '@/core/types';
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
  importWorkspaceFile: vi.fn(),
  readFile: vi.fn(),
  mkdir: vi.fn(),
  documentDir: vi.fn(),
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
      importWorkspaceFile: mocks.importWorkspaceFile,
      readFile: mocks.readFile,
      mkdir: mocks.mkdir,
    },
    osBridge: {
      ...actual.osBridge,
      documentDir: mocks.documentDir,
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
  useOfficeGuideStore.getState().close();
  useDiscoveryStore.setState({ skills: [], agents: [], experts: [], isLoading: false });
  mocks.fetchSkills.mockResolvedValue({ skills: [], disabled: [], installed_count: 0 });
  useSettingsStore.setState({
    language: 'zh-CN',
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
  mocks.importWorkspaceFile.mockImplementation(async (_workspace: string, source: string) => source);
  mocks.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.documentDir.mockResolvedValue('/Users/test/Documents');
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

async function addFilesFromPicker(view: HTMLDivElement): Promise<void> {
  await act(async () => view.querySelector<HTMLButtonElement>('[data-composer-attachment-trigger]')?.click());
  const addFiles = [...view.querySelectorAll<HTMLButtonElement>('[data-composer-plus-menu] button')]
    .find((button) => /添加文件|Add files/.test(button.textContent ?? ''));
  expect(addFiles).toBeDefined();
  await act(async () => addFiles?.click());
}

describe('ChatInput workspace file imports', () => {
  const workspaceScope = { project_path: '/workspace/my-project', project_name: 'my-project', access_mode: 'full' as const, restrict_to_workspace: false };

  it('sends the workspace copy instead of the external file path', async () => {
    mocks.openFolderDialog.mockResolvedValue(['/outside/report.pdf']);
    mocks.importWorkspaceFile.mockResolvedValue('/workspace/my-project/attachments/report.pdf');
    const onSend = vi.fn().mockReturnValue(true);
    const view = await renderChatInput('chat', onSend, { workspaceScope });

    await addFilesFromPicker(view);
    expect(mocks.importWorkspaceFile).toHaveBeenCalledWith('/workspace/my-project', '/outside/report.pdf');
    expect(view.querySelector('[data-local-path-kind="file"]')?.textContent).toContain('report.pdf');
    await act(async () => view.querySelector<HTMLButtonElement>('[data-codex-send-button]')?.click());
    expect(onSend.mock.calls[0][0]).toContain('/workspace/my-project/attachments/report.pdf');
    expect(onSend.mock.calls[0][0]).not.toContain('/outside/report.pdf');
  });

  it('reads image bytes from the workspace copy', async () => {
    mocks.openFolderDialog.mockResolvedValue(['/outside/image.png']);
    mocks.importWorkspaceFile.mockResolvedValue('/workspace/my-project/attachments/image.png');
    const onSend = vi.fn().mockReturnValue(true);
    const view = await renderChatInput('chat', onSend, { workspaceScope });

    await addFilesFromPicker(view);
    expect(mocks.readFile).toHaveBeenCalledWith('/workspace/my-project/attachments/image.png');
    await act(async () => view.querySelector<HTMLButtonElement>('[data-codex-send-button]')?.click());
    expect(onSend.mock.calls[0][1]).toEqual([expect.objectContaining({ data: 'AQID', mediaType: 'image/png' })]);
  });

  it('imports dropped files through the same workspace copy path', async () => {
    mocks.importWorkspaceFile.mockResolvedValue('/workspace/my-project/attachments/report.pdf');
    const view = await renderChatInput('chat', () => true, { workspaceScope });
    const file = Object.assign(new File(['report'], 'report.pdf'), { path: '/outside/report.pdf' });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });

    await act(async () => window.dispatchEvent(drop));
    expect(mocks.importWorkspaceFile).toHaveBeenCalledWith('/workspace/my-project', '/outside/report.pdf');
    expect(view.querySelector('[data-local-path-kind="file"]')).not.toBeNull();
  });

  it('does not attach the original path if importing fails', async () => {
    mocks.openFolderDialog.mockResolvedValue(['/outside/report.pdf']);
    mocks.importWorkspaceFile.mockRejectedValue(new Error('read denied'));
    const view = await renderChatInput('chat', () => true, { workspaceScope });

    await addFilesFromPicker(view);
    expect(view.querySelector('[data-local-path-kind]')).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe('无法将文件添加到工作空间');
  });

  it('does not send while the workspace copy is still in progress', async () => {
    let finishImport: (path: string) => void = () => {};
    mocks.openFolderDialog.mockResolvedValue(['/outside/report.pdf']);
    mocks.importWorkspaceFile.mockImplementation(() => new Promise<string>((resolve) => {
      finishImport = resolve;
    }));
    const onSend = vi.fn().mockReturnValue(true);
    const view = await renderChatInput('chat', onSend, { workspaceScope });

    await addFilesFromPicker(view);
    expect(view.querySelector('[data-composer-attachment-trigger]')?.getAttribute('aria-busy')).toBe('true');
    expect(view.querySelector<HTMLButtonElement>('[data-codex-send-button]')?.disabled).toBe(true);
    await act(async () => finishImport('/workspace/my-project/attachments/report.pdf'));
    expect(view.querySelector('[data-local-path-kind="file"]')).not.toBeNull();
    await act(async () => view.querySelector<HTMLButtonElement>('[data-codex-send-button]')?.click());
    expect(onSend.mock.calls[0][0]).toContain('/workspace/my-project/attachments/report.pdf');
  });

  it('keeps the existing direct-path behavior when no workspace is selected', async () => {
    mocks.openFolderDialog.mockResolvedValue(['/outside/report.pdf']);
    const onSend = vi.fn().mockReturnValue(true);
    const view = await renderChatInput('chat', onSend);

    await addFilesFromPicker(view);
    expect(mocks.importWorkspaceFile).not.toHaveBeenCalled();
    await act(async () => view.querySelector<HTMLButtonElement>('[data-codex-send-button]')?.click());
    expect(onSend.mock.calls[0][0]).toContain('/outside/report.pdf');
  });

  it('imports into an explicitly selected directory even when its name is workspace', async () => {
    mocks.openFolderDialog.mockResolvedValue(['/outside/report.pdf']);
    mocks.importWorkspaceFile.mockResolvedValue('/workspace/attachments/report.pdf');
    const view = await renderChatInput('chat', () => true, {
      workspaceScope: { ...workspaceScope, project_path: '/workspace', project_name: 'workspace' },
    });

    await addFilesFromPicker(view);
    expect(mocks.importWorkspaceFile).toHaveBeenCalledWith('/workspace', '/outside/report.pdf');
  });
});

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
    const shortcutRow = view.querySelector<HTMLElement>('[data-welcome-shortcuts]');
    const shortcuts = [...view.querySelectorAll<HTMLButtonElement>('[data-welcome-shortcut]')];

    expect(shell).not.toBeNull();
    expect(projectSelector).not.toBeNull();
    expect(composer).not.toBeNull();
    expect(shortcutRow).not.toBeNull();
    expect(shell?.contains(shortcutRow ?? null)).toBe(false);
    expect(shell?.nextElementSibling).toBe(shortcutRow);
    expect(Number(textarea?.rows)).toBe(2);
    expect(textarea?.className).toContain('min-h-[52px]');
    expect(textarea?.placeholder).toMatch(
      /问数据、做研究、写材料，或直接交代一项任务……|Ask about data, research a topic, draft materials, or assign a task\.\.\./,
    );
    expect(shortcuts.map((button) => button.dataset.welcomeShortcut)).toEqual([
      'investment-analysis',
      'fixed-income',
      'data-analysis',
      'office',
    ]);
    expect(shortcuts[0]?.textContent).toMatch(/权益投研|Equity Research/);
    expect(shortcuts[1]?.textContent).toMatch(/固收业务|Fixed Income/);
    expect(shortcuts[2]?.textContent).toMatch(/数据分析|Data Analysis/);
    expect(shortcuts[3]?.textContent).toMatch(/综合办公|Office Work/);

    await act(async () => shortcuts[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(shortcuts[0]?.dataset.active).toBe('true');
    expect(view.querySelector('[data-welcome-shortcut-panel]')).not.toBeNull();
  });

  it('shares composer controls while keeping conversations compact and floating', async () => {
    const view = await renderChatInput('chat');
    const shell = view.querySelector<HTMLElement>('[data-codex-composer-shell]');
    const composer = shell?.querySelector<HTMLElement>('[data-codex-composer-card]');
    const textarea = composer?.querySelector<HTMLTextAreaElement>('[data-codex-composer-input]');

    expect(shell?.dataset.composerVariant).toBe('chat');
    expect(shell?.hasAttribute('data-welcome-composer-shell')).toBe(false);
    expect(composer).not.toBeNull();
    expect(shell?.className).toContain('rounded-[20px]');
    expect(composer?.className).toContain('rounded-[20px]');
    expect(composer?.dataset.floatingComposer).toBe('true');
    expect(Number(textarea?.rows)).toBe(1);
    expect(textarea?.className).toContain('min-h-[28px]');
    expect(textarea?.className).toContain('text-[15px]');
    expect(textarea?.style.overflowY).toBe('hidden');
    expect(view.querySelector('[data-codex-composer-toolbar]')).not.toBeNull();
    expect(view.querySelector('[data-codex-model-picker]')).not.toBeNull();
    const sendButton = view.querySelector<HTMLButtonElement>('[data-codex-send-button]');
    expect(sendButton?.classList.contains('composer-send-button')).toBe(true);
    expect(sendButton?.getAttribute('aria-label')).toMatch(/发送消息|Send message/);
    expect(sendButton?.querySelector('svg.lucide-arrow-up')).not.toBeNull();
    const projectSelector = view.querySelector<HTMLElement>('[data-codex-project-selector]');
    expect(projectSelector?.dataset.composerProjectSelectorPlacement).toBe('outside');
    expect(composer?.nextElementSibling).toBe(projectSelector);
    expect(shell?.contains(projectSelector ?? null)).toBe(true);
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

describe('ChatInput investment research shortcuts', () => {
  const workspacePath = '/Users/test/Documents/TPCowork Projects/我的投研分析';
  const stockTeam = { ...investmentTeam, id: 'asset-research-team', member_count: 4 };
  const supplyChainTeam = {
    ...investmentTeam,
    id: 'supply-chain-bottleneck-team',
    name: '资产投研团队 · 供应链瓶颈研究',
  };

  beforeEach(() => {
    mocks.fetchExpertTeams.mockResolvedValue({ teams: [stockTeam, supplyChainTeam] });
    useToastStore.setState({ toasts: [] });
  });

  async function selectResearch(view: HTMLDivElement, key = 'stock_research') {
    await act(async () => view.querySelector<HTMLButtonElement>('[data-welcome-shortcut="investment-analysis"]')!.click());
    const option = view.querySelector<HTMLButtonElement>(`[data-welcome-shortcut-option="${key}"]`)!;
    expect(option).not.toBeNull();
    expect(option.disabled).toBe(false);
    await act(async () => option.click());
    return option;
  }

  it.each([
    { key: 'stock_research', team: stockTeam, subject: '【公司名称或股票代码】', replacement: '贵州茅台（600519）', focus: '估值与安全边际' },
    { key: 'supply_chain_opportunities', team: supplyChainTeam, subject: '【产业主题或趋势】', replacement: 'AI 算力基础设施', focus: '供需瓶颈及持续时间' },
  ])('prepares $key and sends the selected team and workspace after the subject is filled', async ({ key, team, subject, replacement, focus }) => {
    const onSend = vi.fn().mockReturnValue(true);
    const onWorkspaceScopeChange = vi.fn();
    const view = await renderChatInput('welcome', onSend, { onWorkspaceScopeChange });

    await selectResearch(view, key);

    expect(mocks.mkdir).toHaveBeenCalledWith(workspacePath, { recursive: true });
    expect(onWorkspaceScopeChange).toHaveBeenCalledWith({
      project_path: workspacePath,
      project_name: '我的投研分析',
      access_mode: 'full',
      restrict_to_workspace: false,
    });
    expect(useWorkspaceStore.getState().currentPath).toBe(workspacePath);
    expect(useWorkspaceStore.getState().recentPaths).toEqual([workspacePath]);
    expect(view.querySelector('[data-welcome-project-selector]')?.textContent).toContain('我的投研分析');
    expect(view.querySelector(`[data-selected-expert-team="${team.id}"]`)?.textContent).toContain(team.name);
    expect(useChatStore.getState().activeConversationId).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
    expect(mocks.setExpertTeam).not.toHaveBeenCalled();

    const textarea = view.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(textarea.value).toContain(focus);
    expect(textarea.value).toContain('Markdown、HTML');
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(textarea);
      expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe(subject);
    });
    const submit = view.querySelector<HTMLButtonElement>('[data-welcome-submit]')!;
    expect(submit.disabled).toBe(true);

    const filledPrompt = textarea.value.replace(subject, replacement);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, filledPrompt);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());

    expect(onSend).toHaveBeenCalledWith(filledPrompt, undefined, workspacePath, expect.objectContaining({
      expertTeam: { id: team.id, name: team.name, version: team.version, member_count: team.member_count },
    }));
  });

  it('reuses the workspace when switching research tasks and keeps attached materials', async () => {
    localStorage.setItem('nanobot.gui.composerDraft.v1:welcome', JSON.stringify({
      text: '研究资料',
      files: [{ id: 'report', kind: 'file', path: `${workspacePath}/财报.pdf`, name: '财报.pdf' }],
      presentation: { template_id: 'taiping-standard', document_id: 'document-001', name: '中国太平标准', sample_first: true },
    }));
    const view = await renderChatInput('welcome');

    await selectResearch(view);
    await selectResearch(view, 'supply_chain_opportunities');

    expect(mocks.mkdir.mock.calls.map(([path]) => path)).toEqual([workspacePath, workspacePath]);
    expect(useWorkspaceStore.getState().recentPaths).toEqual([workspacePath]);
    expect(useChatStore.getState().pendingExpertTeam?.id).toBe(supplyChainTeam.id);
    expect(view.textContent).toContain('财报.pdf');
    expect(view.querySelector('[data-presentation-selection]')).toBeNull();
    expect(view.querySelector('textarea')?.value).toContain('【产业主题或趋势】');
  });

  it('uses the Windows documents directory and preserves the workspace access mode in English', async () => {
    mocks.documentDir.mockResolvedValue('C:\\Users\\test\\Documents\\');
    useSettingsStore.setState({ language: 'en-US' });
    const onWorkspaceScopeChange = vi.fn();
    const view = await renderChatInput('welcome', () => true, {
      workspaceScope: { project_path: 'C:\\previous', access_mode: 'restricted', restrict_to_workspace: true },
      onWorkspaceScopeChange,
    });

    await selectResearch(view, 'supply_chain_opportunities');

    expect(mocks.mkdir).toHaveBeenCalledWith('C:\\Users\\test\\Documents\\TPCowork Projects\\我的投研分析', { recursive: true });
    expect(onWorkspaceScopeChange).toHaveBeenCalledWith(expect.objectContaining({
      project_path: 'C:\\Users\\test\\Documents\\TPCowork Projects\\我的投研分析',
      access_mode: 'restricted',
      restrict_to_workspace: true,
    }));
    expect(view.querySelector('textarea')?.value).toContain('[industry theme or trend]');
    expect(view.querySelector<HTMLButtonElement>('[data-welcome-submit]')?.disabled).toBe(true);
  });

  it.each(['missing', 'unavailable'])('keeps the draft intact when the required team is %s', async (state) => {
    mocks.fetchExpertTeams.mockResolvedValue({ teams: state === 'missing' ? [] : [{ ...stockTeam, available: false, unavailable_reason: '团队运行环境未就绪' }] });
    useChatStore.setState({ pendingInput: '已有研究目标' });
    const view = await renderChatInput('welcome');

    await selectResearch(view);

    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(useChatStore.getState().pendingExpertTeam).toBeNull();
    expect(useWorkspaceStore.getState().currentPath).toBeNull();
    expect(view.querySelector('textarea')?.value).toBe('已有研究目标');
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe('投研团队暂不可用');
  });

  it('preserves the existing team, workspace, and prompt if directory creation fails', async () => {
    mocks.mkdir.mockRejectedValueOnce(new Error('Permission denied'));
    useChatStore.setState({ pendingExpertTeam: supplyChainTeam, pendingInput: '已有研究目标' });
    useWorkspaceStore.getState().setWorkspace('/Users/test/existing-project');
    const onWorkspaceScopeChange = vi.fn();
    const view = await renderChatInput('welcome', () => true, { onWorkspaceScopeChange });

    await selectResearch(view);

    expect(onWorkspaceScopeChange).not.toHaveBeenCalled();
    expect(useChatStore.getState().pendingExpertTeam?.id).toBe(supplyChainTeam.id);
    expect(useWorkspaceStore.getState().currentPath).toBe('/Users/test/existing-project');
    expect(view.querySelector('textarea')?.value).toBe('已有研究目标');
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('Permission denied');
  });

  it('prevents sending a partially prepared task and discards late selection after leaving the page', async () => {
    let finishDirectory!: () => void;
    mocks.mkdir.mockReturnValueOnce(new Promise<void>((resolve) => { finishDirectory = resolve; }));
    useChatStore.setState({ pendingInput: '已有研究目标' });
    const onSend = vi.fn();
    const onWorkspaceScopeChange = vi.fn();
    const view = await renderChatInput('welcome', onSend, { onWorkspaceScopeChange });

    const option = await selectResearch(view);
    expect(option.getAttribute('aria-busy')).toBe('true');
    expect(option.disabled).toBe(true);
    const submit = view.querySelector<HTMLButtonElement>('[data-welcome-submit]')!;
    expect(submit.disabled).toBe(true);
    await act(async () => submit.click());
    expect(onSend).not.toHaveBeenCalled();

    await act(async () => { root?.unmount(); root = undefined; });
    await act(async () => finishDirectory());
    expect(onWorkspaceScopeChange).not.toHaveBeenCalled();
    expect(useChatStore.getState().pendingExpertTeam).toBeNull();
    expect(useWorkspaceStore.getState().currentPath).toBeNull();
  });
});

describe('ChatInput fixed-income shortcuts', () => {
  const workspacePath = '/Users/test/Documents/TPCowork Projects/我的固收业务';
  const presets: McpPresetInfo[] = [
    { name: 'juyuan', display_name: '聚源金融数据' },
    { name: 'caihui_mcp', display_name: '财汇金融数据' },
    { name: 'hexin-ifind-ds-news-mcp', display_name: '同花顺资讯数据' },
  ].map((preset) => ({
    ...preset,
    category: 'finance', description: '', docs_url: '', transport: 'streamableHttp',
    requires: '', note: '', install_supported: true, installed: true, configured: true,
    enabled: true, available: true, status: 'configured', required_fields: [], connection_summary: '已连接',
  }));

  beforeEach(() => {
    mocks.fetchMcpPresets.mockResolvedValue({ presets, installed_count: presets.length });
    useToastStore.setState({ toasts: [] });
  });

  async function selectFixedIncomeTask(view: HTMLDivElement, key = 'credit_issuer_research') {
    await act(async () => view.querySelector<HTMLButtonElement>('[data-welcome-shortcut="fixed-income"]')!.click());
    const option = view.querySelector<HTMLButtonElement>(`[data-welcome-shortcut-option="${key}"]`)!;
    expect(option).not.toBeNull();
    expect(option.disabled).toBe(false);
    await act(async () => option.click());
    return option;
  }

  it('prepares issuer research with only Juyuan and Caihui and sends them as real connector attachments', async () => {
    // Previous team/PPT selections must not widen this task's connector scope.
    useChatStore.setState({ pendingExpertTeam: investmentTeam });
    localStorage.setItem('nanobot.gui.composerDraft.v1:welcome', JSON.stringify({
      text: '已有任务',
      files: [{ id: 'holdings', kind: 'file', path: '/Users/test/持仓.csv', name: '持仓.csv' }],
      mcpPresets: [presets[2]], cliApps: [{ name: 'old-app' }], skills: ['old-skill'],
      presentation: { template_id: 'taiping-standard', document_id: 'document-001', name: '中国太平标准', sample_first: true },
    }));
    const onSend = vi.fn().mockReturnValue(true);
    const onWorkspaceScopeChange = vi.fn();
    const view = await renderChatInput('welcome', onSend, { onWorkspaceScopeChange });

    await selectFixedIncomeTask(view);

    expect(mocks.fetchMcpPresets).toHaveBeenLastCalledWith('token', 'http://127.0.0.1:8900');
    expect(mocks.mkdir).toHaveBeenCalledWith(workspacePath, { recursive: true });
    expect(onWorkspaceScopeChange).toHaveBeenCalledWith({
      project_path: workspacePath, project_name: '我的固收业务',
      access_mode: 'full', restrict_to_workspace: false,
    });
    expect(useWorkspaceStore.getState().currentPath).toBe(workspacePath);
    expect(view.querySelector('[data-welcome-project-selector]')?.textContent).toContain('我的固收业务');
    expect([...view.querySelectorAll<HTMLElement>('[data-selected-mcp-preset]')].map((chip) => chip.dataset.selectedMcpPreset))
      .toEqual(['juyuan', 'caihui_mcp']);
    expect(useChatStore.getState().pendingExpertTeam).toBeNull();
    expect(view.querySelector('[data-presentation-selection]')).toBeNull();
    expect(view.textContent).toContain('持仓.csv');
    expect(onSend).not.toHaveBeenCalled();
    expect(mocks.setMcpPresets).not.toHaveBeenCalled();

    const textarea = view.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(textarea.value).toContain('信用债主体研究');
    expect(textarea.value).toContain('还本付息');
    expect(textarea.value).toContain('数据截止时间');
    expect(textarea.value).toContain('仅用已选聚源、财汇');
    const submit = view.querySelector<HTMLButtonElement>('[data-welcome-submit]')!;
    expect(submit.disabled).toBe(true);
    await vi.waitFor(() => {
      expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('【发行人名称或债券代码】');
    });
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onSend).not.toHaveBeenCalled();
    const filledPrompt = textarea.value.replace('【发行人名称或债券代码】', '测试发行人股份有限公司');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, filledPrompt);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());

    const [message, , sentWorkspace, options] = onSend.mock.calls[0];
    expect(message).toContain(filledPrompt);
    expect(message).toContain('/Users/test/持仓.csv');
    expect(message).not.toContain('@old-app');
    expect(sentWorkspace).toBe(workspacePath);
    expect(options.mcpPresets.map((preset: { name: string }) => preset.name)).toEqual(['juyuan', 'caihui_mcp']);
    expect(options.expertTeam).toBeUndefined();
    expect(options.presentation).toBeUndefined();
    expect(options.cliApps).toBeUndefined();
    expect(options.skillScope.explicit_skills).toEqual([]);
  });

  it.each([
    { language: 'zh-CN' as const, subject: '【债券代码或筛选条件】', documents: '/Users/test/Documents', workspace: workspacePath },
    { language: 'en-US' as const, subject: '[bond code or screening criteria]', documents: 'C:\\Users\\test\\Documents\\', workspace: 'C:\\Users\\test\\Documents\\TPCowork Projects\\我的固收业务' },
  ])('requires a bond or screening criteria before sending and reuses the workspace in $language', async ({ language, subject, documents, workspace }) => {
    useSettingsStore.setState({ language });
    mocks.documentDir.mockResolvedValue(documents);
    const onSend = vi.fn().mockReturnValue(true);
    const onWorkspaceScopeChange = vi.fn();
    const view = await renderChatInput('welcome', onSend, { onWorkspaceScopeChange });
    await selectFixedIncomeTask(view);
    await selectFixedIncomeTask(view, 'bond_relative_value');

    expect(mocks.mkdir.mock.calls.map(([path]) => path)).toEqual([workspace, workspace]);
    expect(useWorkspaceStore.getState().recentPaths).toEqual([workspace.replace(/\\/g, '/')]);
    expect(onWorkspaceScopeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      project_path: workspace, access_mode: 'full', restrict_to_workspace: false,
    }));
    const textarea = view.querySelector<HTMLTextAreaElement>('textarea')!;
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(textarea);
      expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe(subject);
    });
    const submit = view.querySelector<HTMLButtonElement>('[data-welcome-submit]')!;
    expect(submit.disabled).toBe(true);
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onSend).not.toHaveBeenCalled();

    const filledPrompt = textarea.value.replace(subject, '人民币、剩余期限 1—3 年、AAA 级信用债');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, filledPrompt);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    expect(onSend).toHaveBeenCalledWith(filledPrompt, undefined, workspace, expect.objectContaining({
      mcpPresets: [expect.objectContaining({ name: 'juyuan' }), expect.objectContaining({ name: 'caihui_mcp' })],
    }));
  });

  it.each(['missing', 'disabled', 'unconfigured', 'unavailable'])('preserves the previous setup if Caihui is %s instead of substituting iFinD', async (state) => {
    useChatStore.setState({ pendingExpertTeam: investmentTeam, pendingInput: '已有分析目标' });
    useWorkspaceStore.getState().setWorkspace('/Users/test/existing-project');
    const onWorkspaceScopeChange = vi.fn();
    const view = await renderChatInput('welcome', () => true, { onWorkspaceScopeChange });
    // Check again at click time in case connector settings changed after mount.
    const changedPresets = presets.flatMap((preset) => {
      if (preset.name !== 'caihui_mcp') return [preset];
      if (state === 'missing') return [];
      return [{
        ...preset,
        enabled: state !== 'disabled',
        configured: state !== 'unconfigured',
        available: state !== 'unavailable',
      }];
    });
    mocks.fetchMcpPresets.mockResolvedValue({ presets: changedPresets, installed_count: changedPresets.length });

    await selectFixedIncomeTask(view);

    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(onWorkspaceScopeChange).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().currentPath).toBe('/Users/test/existing-project');
    expect(useChatStore.getState().pendingExpertTeam?.id).toBe(investmentTeam.id);
    expect(view.querySelector('textarea')?.value).toBe('已有分析目标');
    expect(view.querySelector('[data-selected-mcp-preset]')).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('财汇连接器暂不可用');
  });

  it('preserves the previous draft and connectors if workspace creation fails', async () => {
    localStorage.setItem('nanobot.gui.composerDraft.v1:welcome', JSON.stringify({
      text: '已有分析目标', mcpPresets: [presets[2]],
    }));
    useChatStore.setState({ pendingExpertTeam: investmentTeam });
    mocks.mkdir.mockRejectedValueOnce(new Error('Permission denied'));
    const onWorkspaceScopeChange = vi.fn();
    const view = await renderChatInput('welcome', () => true, { onWorkspaceScopeChange });

    await selectFixedIncomeTask(view);

    expect(onWorkspaceScopeChange).not.toHaveBeenCalled();
    expect(view.querySelector('textarea')?.value).toBe('已有分析目标');
    expect(view.querySelector('[data-selected-mcp-preset="hexin-ifind-ds-news-mcp"]')).not.toBeNull();
    expect(useChatStore.getState().pendingExpertTeam?.id).toBe(investmentTeam.id);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('Permission denied');
  });

  it('prevents partial sends and ignores a connector response after leaving the page', async () => {
    const onSend = vi.fn();
    const onWorkspaceScopeChange = vi.fn();
    useChatStore.setState({ pendingInput: '已有分析目标' });
    const view = await renderChatInput('welcome', onSend, { onWorkspaceScopeChange });
    let finishLoading!: (payload: { presets: McpPresetInfo[]; installed_count: number }) => void;
    mocks.fetchMcpPresets.mockReturnValueOnce(new Promise((resolve) => { finishLoading = resolve; }));

    const option = await selectFixedIncomeTask(view);
    expect(option.getAttribute('aria-busy')).toBe('true');
    expect(option.disabled).toBe(true);
    expect(view.querySelector<HTMLButtonElement>('[data-welcome-submit]')?.disabled).toBe(true);
    await act(async () => view.querySelector('textarea')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onSend).not.toHaveBeenCalled();

    await act(async () => { root?.unmount(); root = undefined; });
    await act(async () => finishLoading({ presets, installed_count: presets.length }));
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(onWorkspaceScopeChange).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().currentPath).toBeNull();
  });
});

describe('ChatInput data and office workspace shortcuts', () => {
  const taskSkills: NanobotSkillInfo[] = ['portfolio-analysis', 'office-documents', 'image-extract', 'cron'].map((name) => ({
    name, description: name, path: `/builtin/${name}/SKILL.md`, source: 'builtin',
    enabled: true, available: true, missing: '', user_invocable: true, always: false, tags: [],
  }));
  const connectors: McpPresetInfo[] = ['juyuan', 'caihui_mcp', 'hexin-ifind-ds-news-mcp'].map((name) => ({
    name, display_name: name, description: '', category: 'finance', docs_url: '', transport: 'streamableHttp',
    requires: '', note: '', install_supported: true, installed: true, enabled: true,
    configured: true, available: true, status: 'configured', required_fields: [], connection_summary: '',
  }));

  beforeEach(() => {
    mocks.fetchSkills.mockResolvedValue({ skills: taskSkills, disabled: [], installed_count: taskSkills.length });
    mocks.fetchMcpPresets.mockResolvedValue({ presets: connectors, installed_count: 3 });
    useToastStore.setState({ toasts: [] });
  });

  async function selectTask(view: HTMLDivElement, category: string, key: string) {
    await act(async () => view.querySelector<HTMLButtonElement>(`[data-welcome-shortcut="${category}"]`)!.click());
    const option = view.querySelector<HTMLButtonElement>(`[data-welcome-shortcut-option="${key}"]`)!;
    expect(option).not.toBeNull();
    expect(option.disabled).toBe(false);
    await act(async () => option.click());
    return option;
  }

  async function clickGuidePrimary() {
    const button = document.querySelector<HTMLButtonElement>('[data-office-guide-primary]');
    expect(button).not.toBeNull();
    await act(async () => button!.click());
  }

  it.each(['department_report', 'business_email'])('guides actual office clicks and fills the %s example without sending it', async (example) => {
    useOfficeGuideStore.getState().open();
    const onSend = vi.fn().mockReturnValue(true);
    const view = await renderChatInput('welcome', onSend);
    expect(document.querySelector('[data-office-task-guide]')?.getAttribute('data-office-task-guide')).toBe('welcome');
    expect(mocks.mkdir).not.toHaveBeenCalled();

    await clickGuidePrimary();
    expect(useOfficeGuideStore.getState().step).toBe('category');
    await selectTask(view, 'office', 'draft_material');
    expect(useOfficeGuideStore.getState().step).toBe('workspace');
    expect(view.querySelector('[data-welcome-project-selector]')?.textContent).toContain('我的综合办公');
    await clickGuidePrimary();
    expect(useOfficeGuideStore.getState().step).toBe('skills');
    expect([...view.querySelectorAll<HTMLElement>('[data-selected-skill]')].map((chip) => chip.dataset.selectedSkill))
      .toEqual(['office-documents', 'image-extract']);
    await clickGuidePrimary();
    expect(useOfficeGuideStore.getState().step).toBe('compose');
    await act(async () => document.querySelector<HTMLButtonElement>(`[data-office-guide-example="${example}"]`)!.click());

    expect(useOfficeGuideStore.getState().step).toBeNull();
    expect(document.querySelector('[data-office-task-guide]')).toBeNull();
    expect(view.querySelector('textarea')?.value).toContain('练习素材');
    expect(view.querySelector('textarea')?.value).toContain('主要改动及待确认事项');
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => view.querySelector<HTMLButtonElement>('[data-welcome-submit]')!.click());
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining('练习素材'), undefined,
      '/Users/test/Documents/TPCowork Projects/我的综合办公', expect.objectContaining({
        skillScope: { explicit_skills: ['office-documents', 'image-extract'], project_bound_user_skills: [] },
      }));
  });

  it('waits for real task preparation and lets the user retry a failed setup from the guide', async () => {
    useOfficeGuideStore.getState().open();
    useChatStore.setState({ pendingInput: '保留我的原稿' });
    const onSend = vi.fn();
    const view = await renderChatInput('welcome', onSend);
    await clickGuidePrimary();
    await clickGuidePrimary();
    expect(useOfficeGuideStore.getState().step).toBe('task');
    let rejectLoading!: (error: Error) => void;
    mocks.fetchSkills.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectLoading = reject; }));
    await clickGuidePrimary();
    expect(useOfficeGuideStore.getState().step).toBe('task');
    expect(document.querySelector<HTMLButtonElement>('[data-office-guide-primary]')?.disabled).toBe(true);
    expect(mocks.mkdir).not.toHaveBeenCalled();

    await act(async () => rejectLoading(new Error('服务暂未就绪，请重试')));
    expect(useOfficeGuideStore.getState().step).toBe('task');
    expect(document.querySelector('[data-office-task-guide] [role="alert"]')?.textContent).toContain('服务暂未就绪');
    expect(view.querySelector('textarea')?.value).toBe('保留我的原稿');
    await clickGuidePrimary();
    expect(useOfficeGuideStore.getState().step).toBe('workspace');
    expect(useOfficeGuideStore.getState().error).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('can skip or dismiss the tour without changing the draft or creating a workspace', async () => {
    useOfficeGuideStore.getState().open();
    useChatStore.setState({ pendingInput: '我的写作要求' });
    const view = await renderChatInput('welcome');
    await act(async () => document.querySelector<HTMLButtonElement>('[data-office-guide-close]')!.click());
    expect(view.querySelector('textarea')?.value).toBe('我的写作要求');
    expect(useOfficeGuideStore.getState().step).toBeNull();
    await act(async () => useOfficeGuideStore.getState().open());
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[data-office-task-guide]')).toBeNull();
    expect(view.querySelector('textarea')?.value).toBe('我的写作要求');
    expect(mocks.mkdir).not.toHaveBeenCalled();
  });

  it('keeps Data Analysis with exactly the two holdings tasks', async () => {
    useSettingsStore.getState().setLanguage('zh-CN');
    const view = await renderChatInput('welcome');
    const category = view.querySelector<HTMLButtonElement>('[data-welcome-shortcut="data-analysis"]')!;
    expect(category.textContent).toBe('数据分析');
    await act(async () => category.click());
    expect([...view.querySelectorAll('[data-welcome-shortcut-option]')].map((option) => option.textContent))
      .toEqual(['持仓结构体检', '持仓变动复盘']);
  });

  it.each([
    { category: 'data-analysis', key: 'portfolio_structure_review', workspace: '我的数据分析', skills: ['portfolio-analysis'], finance: true },
    { category: 'data-analysis', key: 'portfolio_changes_review', workspace: '我的数据分析', skills: ['portfolio-analysis'], finance: true },
    { category: 'office', key: 'draft_material', workspace: '我的综合办公', skills: ['office-documents', 'image-extract'], finance: false },
    { category: 'office', key: 'meeting_minutes_actions', workspace: '我的综合办公', skills: ['office-documents', 'image-extract'], finance: false },
    { category: 'office', key: 'weekly_work_report', workspace: '我的综合办公', skills: ['office-documents', 'image-extract', 'cron'], finance: false },
  ])('prepares $key without auto-sending and carries the real skills, workspace, and source files', async ({ category, key, workspace, skills, finance }) => {
    useChatStore.setState({ pendingExpertTeam: investmentTeam });
    localStorage.setItem('nanobot.gui.composerDraft.v1:welcome', JSON.stringify({
      text: '旧任务', files: [{ id: 'source', kind: 'file', path: '/Users/test/资料.xlsx', name: '资料.xlsx' }],
      mcpPresets: [connectors[2]], skills: ['old-skill'], cliApps: [{ name: 'old-app' }],
      presentation: { template_id: 'taiping-standard', document_id: 'doc-1', name: '旧文稿', sample_first: true },
    }));
    const onSend = vi.fn().mockReturnValue(true);
    const onWorkspaceScopeChange = vi.fn();
    const view = await renderChatInput('welcome', onSend, { onWorkspaceScopeChange });
    mocks.fetchMcpPresets.mockClear();

    await selectTask(view, category, key);

    const path = `/Users/test/Documents/TPCowork Projects/${workspace}`;
    expect(mocks.mkdir).toHaveBeenCalledWith(path, { recursive: true });
    expect(onWorkspaceScopeChange).toHaveBeenCalledWith({
      project_path: path, project_name: workspace, access_mode: 'full', restrict_to_workspace: false,
    });
    expect(view.querySelector('[data-welcome-project-selector]')?.textContent).toContain(workspace);
    expect([...view.querySelectorAll<HTMLElement>('[data-selected-skill]')].map((chip) => chip.dataset.selectedSkill))
      .toEqual(skills);
    expect(view.querySelector('[data-selected-skill="old-skill"]')).toBeNull();
    expect(view.querySelector('[data-presentation-selection]')).toBeNull();
    expect(useChatStore.getState().pendingExpertTeam).toBeNull();
    expect(view.textContent).toContain('资料.xlsx');
    expect(onSend).not.toHaveBeenCalled();
    expect(mocks.fetchSkills).toHaveBeenLastCalledWith('token', 'http://127.0.0.1:8900');
    expect([...view.querySelectorAll<HTMLElement>('[data-selected-mcp-preset]')].map((chip) => chip.dataset.selectedMcpPreset))
      .toEqual(finance ? ['juyuan', 'caihui_mcp'] : []);
    if (!finance) expect(mocks.fetchMcpPresets).not.toHaveBeenCalled();

    const prompt = view.querySelector<HTMLTextAreaElement>('textarea')!.value;
    await act(async () => view.querySelector<HTMLButtonElement>('[data-welcome-submit]')!.click());
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining(prompt), undefined, path, expect.objectContaining({
      skillScope: { explicit_skills: skills, project_bound_user_skills: [] },
    }));
    const [message, , , options] = onSend.mock.calls[0];
    expect(message).toContain('/Users/test/资料.xlsx');
    for (const skill of skills) expect(message).not.toContain(`/${skill}`);
    expect(options.expertTeam).toBeUndefined();
    expect(options.presentation).toBeUndefined();
    expect(options.cliApps).toBeUndefined();
    expect(options.mcpPresets?.map((preset: { name: string }) => preset.name) ?? [])
      .toEqual(finance ? ['juyuan', 'caihui_mcp'] : []);
  });

  it.each(['not configured', 'catalog unavailable'])('can analyze supplied holdings when optional financial connectors are %s', async (state) => {
    const view = await renderChatInput('welcome');
    if (state === 'not configured') {
      mocks.fetchMcpPresets.mockResolvedValue({ presets: [connectors[2]], installed_count: 1 });
    } else {
      mocks.fetchMcpPresets.mockRejectedValueOnce(new Error('MCP catalog timed out'));
    }

    await selectTask(view, 'data-analysis', 'portfolio_structure_review');

    expect(view.querySelector('[data-selected-skill="portfolio-analysis"]')).not.toBeNull();
    expect(view.querySelector('[data-selected-mcp-preset]')).toBeNull();
    expect(view.querySelector('textarea')?.value).toContain('上传 Excel');
    expect(useWorkspaceStore.getState().currentPath).toContain('我的数据分析');
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it.each(['missing', 'disabled', 'unavailable', 'ungranted workspace override'])('keeps the previous draft when its required skill is %s', async (state) => {
    useChatStore.setState({ pendingExpertTeam: investmentTeam, pendingInput: '已有研究目标' });
    const view = await renderChatInput('welcome');
    mocks.fetchSkills.mockResolvedValue({
      skills: state === 'missing' ? [taskSkills[2], taskSkills[3]] : [{
        ...taskSkills[1], enabled: state !== 'disabled', available: state !== 'unavailable',
        source: state === 'ungranted workspace override' ? 'workspace' : 'builtin',
      }, taskSkills[2], taskSkills[3]],
      disabled: [], installed_count: state === 'missing' ? 2 : 3,
    });

    await selectTask(view, 'office', 'weekly_work_report');

    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(view.querySelector('textarea')?.value).toBe('已有研究目标');
    expect(view.querySelector('[data-selected-skill]')).toBeNull();
    expect(useChatStore.getState().pendingExpertTeam?.id).toBe(investmentTeam.id);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('office-documents 技能在此工作空间暂不可用');
  });

  it('reuses category workspaces and replaces capabilities when switching from data to office to equity', async () => {
    mocks.fetchExpertTeams.mockResolvedValue({ teams: [{ ...investmentTeam, id: 'asset-research-team' }] });
    const view = await renderChatInput('welcome');
    await selectTask(view, 'data-analysis', 'portfolio_structure_review');
    await selectTask(view, 'data-analysis', 'portfolio_changes_review');
    expect(useWorkspaceStore.getState().recentPaths).toHaveLength(1);
    await selectTask(view, 'office', 'meeting_minutes_actions');
    await selectTask(view, 'office', 'draft_material');
    expect(useWorkspaceStore.getState().recentPaths).toHaveLength(2);
    expect(view.querySelector('[data-selected-mcp-preset]')).toBeNull();
    expect(view.querySelector('[data-selected-skill="office-documents"]')).not.toBeNull();
    await selectTask(view, 'investment-analysis', 'stock_research');
    expect(view.querySelector('[data-selected-skill]')).toBeNull();
    expect(view.querySelector('[data-selected-expert-team="asset-research-team"]')).not.toBeNull();
  });

  it('prepares English office prompts in a Windows workspace while preserving restricted access', async () => {
    useSettingsStore.setState({ language: 'en-US' });
    mocks.documentDir.mockResolvedValue('C:\\Users\\test\\Documents\\');
    const onWorkspaceScopeChange = vi.fn();
    const view = await renderChatInput('welcome', () => true, {
      workspaceScope: { project_path: 'C:\\previous', access_mode: 'restricted', restrict_to_workspace: true },
      onWorkspaceScopeChange,
    });
    await selectTask(view, 'office', 'weekly_work_report');
    expect(onWorkspaceScopeChange).toHaveBeenCalledWith(expect.objectContaining({
      project_path: 'C:\\Users\\test\\Documents\\TPCowork Projects\\我的综合办公',
      access_mode: 'restricted', restrict_to_workspace: true,
    }));
    expect(view.querySelector('textarea')?.value).toContain('Create a recurring weekly work report task');
    expect(view.querySelector('[data-selected-skill="office-documents"]')).not.toBeNull();
  });

  it('preserves the previous selection when creating an office workspace fails', async () => {
    const view = await renderChatInput('welcome');
    await selectTask(view, 'data-analysis', 'portfolio_structure_review');
    const draft = view.querySelector('textarea')?.value;
    mocks.mkdir.mockRejectedValueOnce(new Error('Permission denied'));
    await selectTask(view, 'office', 'weekly_work_report');
    expect(view.querySelector('textarea')?.value).toBe(draft);
    expect(view.querySelector('[data-selected-skill="portfolio-analysis"]')).not.toBeNull();
    expect(view.querySelector('[data-selected-mcp-preset="juyuan"]')).not.toBeNull();
    expect(useWorkspaceStore.getState().currentPath).toContain('我的数据分析');
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('Permission denied');
  });

  it('blocks partial sends and discards a late skill response after leaving the homepage', async () => {
    const onSend = vi.fn();
    const view = await renderChatInput('welcome', onSend);
    let finishLoading!: (payload: { skills: NanobotSkillInfo[]; disabled: string[]; installed_count: number }) => void;
    mocks.fetchSkills.mockReturnValueOnce(new Promise((resolve) => { finishLoading = resolve; }));
    const option = await selectTask(view, 'office', 'draft_material');
    expect(option.getAttribute('aria-busy')).toBe('true');
    expect(view.querySelector<HTMLButtonElement>('[data-welcome-submit]')?.disabled).toBe(true);
    await act(async () => { root?.unmount(); root = undefined; });
    await act(async () => finishLoading({ skills: taskSkills, disabled: [], installed_count: taskSkills.length }));
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().currentPath).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
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
