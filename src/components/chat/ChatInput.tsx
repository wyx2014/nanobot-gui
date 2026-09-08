import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Plus, ArrowUp, Square, X, ChevronDown, Check, FileText, CornerDownRight, Pencil, Trash2, GraduationCap, Paperclip, ChevronRight, Puzzle, Globe, Search, BarChart3, Users, Mic, Loader2 } from 'lucide-react';
import ThinkingOrb from '@/components/common/ModalAwareThinkingOrb';
import ExpertTeamIcon from '@/components/common/ExpertTeamIcon';
import { dialogBridge, fsBridge, mediaBridge } from '@/lib/ipc-factory';
import { useFileDragDrop } from '@/hooks/useFileDragDrop';
import { uint8ArrayToBase64 } from '@/utils/base64';
import { getBaseName, IMAGE_MIME_MAP, isLocalFilePath } from '@/utils/pathUtils';
import { isImageFile } from '@/components/chat/FileAttachment';
import { useChatStore, useActiveConversation } from '@/stores/chatStore';
import { DEFAULT_FALLBACK_MODEL, useSettingsStore, getEffectiveModel } from '@/stores/settingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { usePermissionStore } from '@/stores/permissionStore';
import { useToastStore } from '@/stores/toastStore';
import type { PermissionDuration } from '@/stores/permissionStore';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ImageAttachment } from '@/types';
import type { OutboundCliAppMention, OutboundMcpPresetMention, OutboundSkillScope } from '@/core/types';
import type { CliAppInfo, ExpertTeamBinding, ExpertTeamSummary, McpPresetInfo, SlashCommand, WorkspaceScopePayload } from '@/core/types';
import { fetchExpertTeams, fetchMcpPresets } from '@/core/api';
import {
  getNanobotClient,
  getNanobotStatus,
  getNanobotToken,
  refreshNanobotAuth,
  switchGatewayTextModelDefault,
} from '@/core/nanobotClient';
import {
  TranscriptionRequestError,
  VoiceStreamError,
  type VoiceStreamMode,
} from '@/core/nanobot-client';
import {
  startPcmVoiceRecorder,
  type PcmVoiceRecorder,
  type VoiceAudioChunk,
  type VoiceRecordingResult,
} from '@/core/audio/pcmVoiceRecorder';
import {
} from '@/lib/cli-app-events';
import {
  MCP_PRESETS_CHANGED_EVENT,
  installedMcpPresetsFromPayload,
  isMcpPresetsPayload,
} from '@/lib/mcp-preset-events';
import { generateAttachmentId, readFileAsBase64, SUPPORTED_IMAGE_TYPES } from '@/utils/imageUtils';
import PermissionDialog from '@/components/common/PermissionDialog';
import FolderSelector from '@/components/common/FolderSelector';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { normalizeProjectPath, projectNameFromPath, visibleProjectPath } from '@/core/workspace';
import { displaySkillName, filterAvailableSkillNames, stripUnavailableLeadingSkillMentions, usableSkillsForScope } from '@/core/skills/filter';
import { LEGACY_LOCAL_FILE_CONTEXT_HEADER } from '@/core/nanobot/localFileContext';
import PresentationPicker from './PresentationPicker';
import { normalizePresentationSelection, type PresentationSelection } from '@/core/presentations';
import { Presentation } from 'lucide-react';

const SHOW_PRESENTATION_PLUS_MENU_ENTRY = false;

export interface ChatInputSendOptions {
  presentation?: PresentationSelection;
  cliApps?: OutboundCliAppMention[];
  mcpPresets?: OutboundMcpPresetMention[];
  skillScope?: OutboundSkillScope;
  expertTeam?: ExpertTeamBinding;
}

interface ShortcutOption {
  key: string;
  labelZh: string;
  labelEn: string;
  promptZh: string;
  promptEn: string;
}

interface ShortcutCategory {
  id: string;
  icon: any;
  labelKey: 'shortcutDataAnalysis' | 'shortcutOffice';
  options: ShortcutOption[];
}

function modelDisplayName(model: string): string {
  return model.split('/').filter(Boolean).pop() ?? model;
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    id: 'data-analysis',
    icon: BarChart3,
    labelKey: 'shortcutDataAnalysis',
    options: [
      {
        key: 'spreadsheet_analysis',
        labelZh: '表格智能分析',
        labelEn: 'Smart spreadsheet analysis',
        promptZh: '请帮我智能分析一份表格或数据文件。先提醒我上传文件并确认分析目标；再检查数据质量、识别异常和趋势，提炼关键结论，并给出可执行的业务建议。',
        promptEn: 'Help me analyze a spreadsheet or data file. First ask me to upload it and confirm the objective, then check data quality, identify anomalies and trends, summarize key findings, and provide actionable recommendations.',
      },
      {
        key: 'metric_comparison',
        labelZh: '指标查询与对比',
        labelEn: 'Metric lookup and comparison',
        promptZh: '请帮我查询并对比关键指标。先确认指标口径、对比对象、时间范围和数据来源；再整理数据、计算变化和差异，并说明可能原因与需关注的信号。',
        promptEn: 'Help me look up and compare key metrics. First confirm the metric definition, comparison targets, time range, and data sources, then organize the data, calculate changes and differences, and explain likely drivers and signals to watch.',
      },
      {
        key: 'data_summary_charts',
        labelZh: '数据总结与图表',
        labelEn: 'Data summaries and charts',
        promptZh: '请基于我提供的数据制作总结和图表。先确认受众、汇报场景和希望回答的问题；再提炼核心结论，推荐合适图表，并输出可直接用于汇报的图表说明和摘要。',
        promptEn: 'Create a concise summary and charts from my data. First confirm the audience, reporting context, and questions to answer, then identify the main findings, recommend suitable charts, and produce presentation-ready captions and a summary.',
      },
    ],
  },
  {
    id: 'office',
    icon: FileText,
    labelKey: 'shortcutOffice',
    options: [
      {
        key: 'draft_material',
        labelZh: '撰写与润色材料',
        labelEn: 'Draft and polish materials',
        promptZh: '请帮我撰写或润色一份工作材料。先询问材料用途、受众、篇幅和语气；如果我已有草稿或参考资料，请提醒我上传或粘贴。',
        promptEn: 'Help me draft or polish a business document. First ask about its purpose, audience, length, and tone, and remind me to provide any draft or reference files I already have.',
      },
      {
        key: 'meeting_minutes_actions',
        labelZh: '会议纪要与待办',
        labelEn: 'Meeting minutes and action items',
        promptZh: '请帮我整理会议纪要和待办事项。提醒我上传或粘贴会议记录，并按议题、核心观点、决策事项、负责人、截止时间和后续行动形成清晰纪要。',
        promptEn: 'Help me prepare meeting minutes and action items. Ask me to upload or paste the meeting record, then organize it by agenda item, key points, decisions, owners, due dates, and follow-up actions.',
      },
      {
        key: 'document_summary',
        labelZh: '文档阅读与总结',
        labelEn: 'Document reading and summary',
        promptZh: '请帮我阅读并总结一份文档。提醒我上传文件或粘贴内容，并根据我的用途提炼核心观点、重要数据、风险事项和待办；必要时给出一页式摘要。',
        promptEn: 'Help me read and summarize a document. Ask me to upload it or paste the content, then extract the key points, important data, risks, and action items for my intended use; provide a one-page brief when useful.',
      },
    ],
  },
];

interface ChatInputProps {
  variant: 'welcome' | 'chat';
  onSend: (message: string, images?: ImageAttachment[], workspacePath?: string | null, options?: ChatInputSendOptions) => boolean | void;
  onStop?: () => void;
  isStreaming?: boolean;
  isStopping?: boolean;
  disabled?: boolean;
  sendDisabled?: boolean;
  workspaceScope?: WorkspaceScopePayload | null;
  onWorkspaceScopeChange?: (scope: WorkspaceScopePayload | null) => void;
}

interface SuggestionItem {
  name: string;
  description: string;
  detail?: string;
  kind: 'slash' | 'cli' | 'mcp' | 'skill';
  slashCommand?: SlashCommand;
  cliApp?: CliAppInfo;
  mcpPreset?: McpPresetInfo;
  skillName?: string;
}

interface FileAttachmentItem {
  id: string;
  path: string;
  name: string;
}

interface ComposerDraft {
  presentation?: PresentationSelection;
  text?: string;
  images?: ImageAttachment[];
  files?: FileAttachmentItem[];
  skills?: string[];
  cliApps?: OutboundCliAppMention[];
  mcpPresets?: OutboundMcpPresetMention[];
}

interface QueuedPrompt extends ComposerDraft {
  id: string;
}

const MAX_IMAGES_PER_MESSAGE = 4;
const DRAFT_STORAGE_PREFIX = 'nanobot.gui.composerDraft.v1:';
const QUEUE_STORAGE_PREFIX = 'nanobot.gui.composerQueue.v1:';
const QUEUED_PROMPTS_LIMIT = 20;

function draftStorageKey(conversationId: string | null | undefined, variant: 'welcome' | 'chat'): string {
  return `${DRAFT_STORAGE_PREFIX}${conversationId || variant}`;
}

function queueStorageKey(conversationId: string | null | undefined, variant: 'welcome' | 'chat'): string {
  return `${QUEUE_STORAGE_PREFIX}${conversationId || variant}`;
}

function normalizeDraft(value: unknown): ComposerDraft | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as ComposerDraft;
  return {
    text: typeof record.text === 'string' ? record.text : '',
    images: Array.isArray(record.images)
      ? record.images.filter((image): image is ImageAttachment =>
        !!image
        && typeof image.id === 'string'
        && typeof image.data === 'string'
        && typeof image.mediaType === 'string',
      ).slice(0, MAX_IMAGES_PER_MESSAGE)
      : [],
    files: Array.isArray(record.files)
      ? record.files.filter((file): file is FileAttachmentItem =>
        !!file
        && typeof file.id === 'string'
        && typeof file.path === 'string'
        && isLocalFilePath(file.path)
        && typeof file.name === 'string',
      )
      : [],
    skills: Array.isArray(record.skills) ? record.skills.filter((skill): skill is string => typeof skill === 'string') : [],
    cliApps: Array.isArray(record.cliApps) ? record.cliApps : [],
    mcpPresets: Array.isArray(record.mcpPresets) ? record.mcpPresets : [],
    presentation: normalizePresentationSelection(record.presentation),
  };
}

function readDraft(key: string): ComposerDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return normalizeDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

function hasDraftPayload(draft: ComposerDraft): boolean {
  return !!draft.text?.trim()
    || !!draft.presentation
    || !!draft.images?.length
    || !!draft.files?.length
    || !!draft.skills?.length
    || !!draft.cliApps?.length
    || !!draft.mcpPresets?.length;
}

function writeDraft(key: string, draft: ComposerDraft): void {
  try {
    if (!hasDraftPayload(draft)) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Draft persistence is best-effort; sending still works without it.
  }
}

function normalizeQueuedPrompt(value: unknown, index: number): QueuedPrompt | null {
  const draft = normalizeDraft(value);
  if (!draft || !hasDraftPayload(draft)) return null;
  const id = typeof (value as { id?: unknown })?.id === 'string'
    ? String((value as { id?: unknown }).id)
    : `queued-restored-${index}`;
  return { id, ...draft };
}

function readQueuedPrompts(key: string): QueuedPrompt[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, index) => normalizeQueuedPrompt(item, index))
      .filter((item): item is QueuedPrompt => item != null)
      .slice(0, QUEUED_PROMPTS_LIMIT);
  } catch {
    return [];
  }
}

function writeQueuedPrompts(key: string, prompts: QueuedPrompt[]): void {
  try {
    if (prompts.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(prompts.slice(0, QUEUED_PROMPTS_LIMIT)));
  } catch {
    // Queue persistence is best-effort.
  }
}

function queuedPromptLabel(prompt: QueuedPrompt): string {
  const text = prompt.text?.trim();
  if (text) return text;
  const files = prompt.files?.map((file) => file.name).filter(Boolean) ?? [];
  if (files.length) return files.join(', ');
  const images = prompt.images?.length ?? 0;
  if (images) return `${images} 张图片`;
  const caps = [
    ...(prompt.skills?.map((skill) => `/${skill}`) ?? []),
    ...(prompt.cliApps?.map((app) => app.display_name || app.name) ?? []),
    ...(prompt.mcpPresets?.map((preset) => preset.display_name || preset.name) ?? []),
  ];
  return caps.join(', ') || '排队指令';
}

/** Read a local image file path into an ImageAttachment via bridge */
async function readLocalImage(filePath: string): Promise<ImageAttachment> {
  const bytes = await fsBridge.readFile(filePath);
  const base64 = uint8ArrayToBase64(bytes);
  const ext = filePath.toLowerCase().split('.').pop() ?? '';
  const mediaType = (IMAGE_MIME_MAP[ext] ?? 'image/jpeg') as ImageAttachment['mediaType'];
  return { id: generateAttachmentId(), data: base64, mediaType };
}

/** Process file paths: read images as base64, collect non-image paths as file badges */
async function processFilePaths(
  paths: string[],
  addImages: (imgs: ImageAttachment[]) => void,
  addFiles: (items: FileAttachmentItem[]) => void,
): Promise<void> {
  const imgPaths: string[] = [];
  const filePaths: string[] = [];
  for (const p of paths) {
    (isImageFile(p) ? imgPaths : filePaths).push(p);
  }
  if (imgPaths.length > 0) {
    const remainingSlots = Math.max(0, MAX_IMAGES_PER_MESSAGE);
    const results = await Promise.allSettled(imgPaths.slice(0, remainingSlots).map(readLocalImage));
    const newImages: ImageAttachment[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        newImages.push(r.value);
      } else {
        filePaths.push(imgPaths[i]);
      }
    });
    if (imgPaths.length > remainingSlots) {
      filePaths.push(...imgPaths.slice(remainingSlots));
    }
    if (newImages.length > 0) addImages(newImages);
  }
  if (filePaths.length > 0) {
    addFiles(filePaths.map((p) => ({ id: generateAttachmentId(), path: p, name: getBaseName(p) })));
  }
}

export default function ChatInput({ variant, onSend, onStop, isStreaming: isStreamingProp, isStopping = false, disabled, sendDisabled, workspaceScope, onWorkspaceScopeChange }: ChatInputProps) {
  const isWelcome = variant === 'welcome';

  const [text, setText] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [files, setFiles] = useState<FileAttachmentItem[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedCliApps, setSelectedCliApps] = useState<OutboundCliAppMention[]>([]);
  const [selectedMcpPresets, setSelectedMcpPresets] = useState<OutboundMcpPresetMention[]>([]);
  const [selectedPresentation, setSelectedPresentation] = useState<PresentationSelection>();
  const [showPresentationPicker, setShowPresentationPicker] = useState(false);
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mcpPresets, setMcpPresets] = useState<McpPresetInfo[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceRecorderRef = useRef<PcmVoiceRecorder | null>(null);
  const voiceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceStartedAtRef = useRef(0);
  const voiceStreamIdRef = useRef<string | null>(null);
  const voiceStreamModeRef = useRef<VoiceStreamMode | null>(null);
  const voiceFinalizingStreamRef = useRef<string | null>(null);
  const voicePendingChunksRef = useRef<VoiceAudioChunk[]>([]);
  const voiceDraftRef = useRef<{
    originalText: string;
    start: number;
    end: number;
    latest: string;
  } | null>(null);
  const [voiceState, setVoiceState] = useState<
    'idle' | 'connecting' | 'recording' | 'finalizing' | 'transcribing'
  >('idle');
  const [voiceElapsedSec, setVoiceElapsedSec] = useState(0);

  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<'project' | 'expert-team' | 'skills' | 'connector' | null>(null);
  const [expertTeamSearchQuery, setExpertTeamSearchQuery] = useState('');
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [connectorSearchQuery, setConnectorSearchQuery] = useState('');
  const [expertTeams, setExpertTeams] = useState<ExpertTeamSummary[]>([]);
  const [expertTeamsLoading, setExpertTeamsLoading] = useState(true);
  const [expertTeamsError, setExpertTeamsError] = useState<string | null>(null);
  const [expertTeamUpdating, setExpertTeamUpdating] = useState(false);
  const [mcpPresetsUpdating, setMcpPresetsUpdating] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const skills = useDiscoveryStore((s) => s.skills);
  const refreshDiscovery = useDiscoveryStore((s) => s.refresh);
  const useBuiltinWebSearch = useSettingsStore((s) => s.useBuiltinWebSearch);
  const setUseBuiltinWebSearch = useSettingsStore((s) => s.setUseBuiltinWebSearch);


  // Welcome-only state (always declared for hook stability)
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const categoryPanelRef = useRef<HTMLDivElement>(null);
  const [hoverPrompt, setHoverPrompt] = useState<string | null>(null);
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  const [localWorkspace, setLocalWorkspace] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const lastCompositionEndTimeRef = useRef<number>(0);
  const skipDraftPersistRef = useRef(false);
  const skipQueuePersistRef = useRef(false);
  const consumedPendingInputRef = useRef(false);
  const wasStreamingRef = useRef(false);
  const skipNextQueuedFlushRef = useRef(false);
  const isSubmittingRef = useRef(false);

  // Store hooks (always called)
  const cancelStreaming = useChatStore((s) => s.cancelStreaming);
  const setConversationExpertTeam = useChatStore((s) => s.setConversationExpertTeam);
  const setConversationMcpPresets = useChatStore((s) => s.setConversationMcpPresets);
  const addToast = useToastStore((s) => s.addToast);
  const pendingInput = useChatStore((s) => s.pendingInput);
  const setPendingInput = useChatStore((s) => s.setPendingInput);
  const pendingExpertTeam = useChatStore((s) => s.pendingExpertTeam);
  const setPendingExpertTeam = useChatStore((s) => s.setPendingExpertTeam);
  const activeConv = useActiveConversation();
  const selectedExpertTeam = activeConv
    ? activeConv.expertTeam ?? null
    : pendingExpertTeam;
  const boundMcpPresets = activeConv?.mcpPresets ?? [];
  const draftKey = useMemo(() => draftStorageKey(activeConv?.id, variant), [activeConv?.id, variant]);
  const queueKey = useMemo(() => queueStorageKey(activeConv?.id, variant), [activeConv?.id, variant]);
  const currentModel = useSettingsStore((s) => getEffectiveModel(s));
  const gatewayTextModels = useSettingsStore((s) => s.gatewayTextModels);
  const activeTextModelPreset = useSettingsStore((s) => s.activeTextModelPreset);
  const gatewayTextModelsHydrated = useSettingsStore((s) => s.gatewayTextModelsHydrated);
  const openSystemSettings = useSettingsStore((s) => s.openSystemSettings);
  const voiceInputAvailable = useSettingsStore((s) => s.voiceInputAvailable);
  const voiceMaxDurationSec = useSettingsStore((s) => s.voiceMaxDurationSec);
  const recentPaths = useWorkspaceStore((s) => s.recentPaths);
  const gatewayProjects = useWorkspaceStore((s) => s.projects);
  const projectsHydrated = useWorkspaceStore((s) => s.projectsHydrated);
  const projectSkillBindings = useWorkspaceStore((s) => s.projectSkillBindings);
  const grantPermission = usePermissionStore((s) => s.grantPermission);
  const hasPermission = usePermissionStore((s) => s.hasPermission);
  const { t } = useI18n();
  const language = useSettingsStore((s) => s.language);
  const isEn = language === 'en-US';

  // Chat-only derived state
  const isRunning = activeConv?.status === 'running';
  const isStreaming = isStreamingProp ?? (!isWelcome && isRunning);
  const activeTextModel = gatewayTextModels.find((model) => (
    model.presetName === activeTextModelPreset
  ));
  const activeTextModelId = activeTextModel?.model ?? currentModel ?? DEFAULT_FALLBACK_MODEL;
  const modelDisplay = modelDisplayName(activeTextModelId);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [switchingModelPreset, setSwitchingModelPreset] = useState<string | null>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);

  const selectTextModel = async (presetName: string) => {
    if (switchingModelPreset || presetName === activeTextModelPreset) {
      setShowModelPicker(false);
      return;
    }
    setSwitchingModelPreset(presetName);
    try {
      await switchGatewayTextModelDefault(presetName);
      setShowModelPicker(false);
    } catch (error) {
      addToast({
        type: 'error',
        title: isEn ? 'Model switch failed' : '模型切换失败',
        message: error instanceof Error ? error.message : String(error),
        duration: 5000,
      });
    } finally {
      setSwitchingModelPreset(null);
    }
  };

  const handleShortcut = (type: string) => {
    setActiveCategory(type);
  };

  const handleShortcutOptionClick = (prompt: string) => {
    const draft = {
      text: prompt,
      images: [],
      files: [],
      skills: [],
      cliApps: [],
      mcpPresets: [],
    };
    if (!submitDraft(draft)) return;
    isSubmittingRef.current = true;
    writeDraft(draftKey, { text: '', images: [], files: [], skills: [], cliApps: [], mcpPresets: [] });
    setActiveCategory(null);
    setHoverPrompt(null);
    resetInput();
  };

  // Close category panel on click outside
  useEffect(() => {
    if (!activeCategory) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (categoryPanelRef.current && !categoryPanelRef.current.contains(e.target as Node)) {
        setActiveCategory(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeCategory]);

  // Close model picker on click outside
  useEffect(() => {
    if (!showModelPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showModelPicker]);
  // Handle pasting images from clipboard
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const availableSlots = Math.max(0, MAX_IMAGES_PER_MESSAGE - images.length);
    if (availableSlots <= 0) return;
    let consumed = 0;
    for (const item of Array.from(items)) {
      if (SUPPORTED_IMAGE_TYPES.includes(item.type)) {
        if (consumed >= availableSlots) break;
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const { data, mediaType } = await readFileAsBase64(file);
        setImages((prev) => [...prev, { id: generateAttachmentId(), data, mediaType }].slice(0, MAX_IMAGES_PER_MESSAGE));
        consumed += 1;
      }
    }
  }, [images.length]);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadExpertTeams = async () => {
      setExpertTeamsLoading(true);
      setExpertTeamsError(null);
      try {
        const status = await getNanobotStatus();
        if (!status.ready) throw new Error(isEn ? 'TP Cowork is not ready' : 'TP Cowork 服务尚未就绪');
        let token = getNanobotToken();
        let base = `http://127.0.0.1:${status.port}`;
        if (!token) {
          const refreshed = await refreshNanobotAuth();
          token = refreshed.token;
          base = refreshed.baseUrl;
        }
        const payload = await fetchExpertTeams(token, base);
        if (!cancelled) setExpertTeams(payload.teams.filter((team) => team.enabled));
      } catch (error) {
        if (!cancelled) {
          setExpertTeams([]);
          setExpertTeamsError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setExpertTeamsLoading(false);
      }
    };
    void loadExpertTeams();
    return () => {
      cancelled = true;
    };
  }, [isEn]);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // Consume pending input
  useEffect(() => {
    if (pendingInput) {
      consumedPendingInputRef.current = true;
      setText(pendingInput);
      setPendingInput(null);
      textareaRef.current?.focus();
    }
  }, [pendingInput, setPendingInput]);

  useEffect(() => {
    if (!isWelcome || !pendingExpertTeam) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isWelcome, pendingExpertTeam]);

  useEffect(() => {
    if (consumedPendingInputRef.current) {
      consumedPendingInputRef.current = false;
      setSelectedPresentation(readDraft(draftKey)?.presentation);
      return;
    }
    skipDraftPersistRef.current = true;
    const draft = readDraft(draftKey);
    setText(draft?.text ?? '');
    setImages(draft?.images ?? []);
    setFiles(draft?.files ?? []);
    setSelectedSkills(draft?.skills ?? []);
    setSelectedCliApps(draft?.cliApps ?? []);
    setSelectedMcpPresets(draft?.mcpPresets ?? []);
    setSelectedPresentation(draft?.presentation);
    window.setTimeout(() => {
      skipDraftPersistRef.current = false;
    }, 0);
  }, [draftKey]);

  useEffect(() => {
    if (skipDraftPersistRef.current) return;
    if (isSubmittingRef.current) {
      const hasPayload = text.trim() || images.length || files.length || selectedSkills.length || selectedCliApps.length || selectedMcpPresets.length || selectedPresentation;
      if (!hasPayload) {
        isSubmittingRef.current = false;
      }
      return;
    }
    writeDraft(draftKey, {
      text,
      images,
      files,
      skills: selectedSkills,
      cliApps: selectedCliApps,
      mcpPresets: selectedMcpPresets,
      presentation: selectedPresentation,
    });
  }, [draftKey, files, images, selectedCliApps, selectedMcpPresets, selectedSkills, selectedPresentation, text]);

  useEffect(() => {
    skipQueuePersistRef.current = true;
    setQueuedPrompts(readQueuedPrompts(queueKey));
    window.setTimeout(() => {
      skipQueuePersistRef.current = false;
    }, 0);
  }, [queueKey]);

  useEffect(() => {
    if (skipQueuePersistRef.current) return;
    writeQueuedPrompts(queueKey, queuedPrompts);
  }, [queueKey, queuedPrompts]);

  const handleStop = () => {
    if (isStopping) return;
    if (queuedPrompts.length > 0) {
      skipNextQueuedFlushRef.current = true;
    }
    if (onStop) {
      onStop();
      return;
    }
    if (activeConv?.id) {
      cancelStreaming(activeConv.id);
    }
  };

  // File drag & drop (always called; works for both variants)
  const { isDragging } = useFileDragDrop(async (paths, unresolvedNames) => {
    if (paths.length > 0) {
      await processFilePaths(
        paths,
        (imgs) => setImages((prev) => [...prev, ...imgs].slice(0, MAX_IMAGES_PER_MESSAGE)),
        (items) => setFiles((prev) => [...prev, ...items]),
      );
    }
    if (unresolvedNames.length > 0) {
      const names = unresolvedNames.slice(0, 3).join('、');
      const more = unresolvedNames.length > 3 ? ` +${unresolvedNames.length - 3}` : '';
      addToast({
        type: 'error',
        title: isEn ? 'Could not add dropped file' : '无法添加拖入的文件',
        message: isEn
          ? `${names}${more} did not provide a readable local path. Please use “+ → Add files”.`
          : `${names}${more} 未提供可读取的本地路径，请使用“+ → 添加文件”。`,
        duration: 5000,
      });
    }
    textareaRef.current?.focus();
  });

  // Welcome-only: folder & permission handlers
  const handleSelectFolder = (folderPath: string) => {
    if (onWorkspaceScopeChange) {
      const base = workspaceScope ?? { access_mode: 'full' as const, restrict_to_workspace: false };
      onWorkspaceScopeChange({
        ...base,
        project_path: folderPath,
        project_name: projectNameFromPath(folderPath),
        access_mode: 'full',
        restrict_to_workspace: false,
      });
    } else if (hasPermission(folderPath, 'read')) {
      setLocalWorkspace(folderPath);
    } else {
      setPendingFolder(folderPath);
    }
  };

  const handleClearWorkspace = () => {
    onWorkspaceScopeChange?.(null);
    setLocalWorkspace(null);
  };

  const handleAllowPermission = (duration: PermissionDuration) => {
    if (pendingFolder) {
      grantPermission(pendingFolder, ['read', 'write', 'execute'], duration);
      setLocalWorkspace(pendingFolder);
      setPendingFolder(null);
    }
  };

  const handleDenyPermission = () => {
    setPendingFolder(null);
  };

  useEffect(() => {
    let cancelled = false;
    const loadCapabilities = async () => {
      try {
        const status = await getNanobotStatus();
        if (!status.ready) return;
        let token = getNanobotToken();
        let base = `http://127.0.0.1:${status.port}`;
        if (!token) {
          const refreshed = await refreshNanobotAuth();
          token = refreshed.token;
          base = refreshed.baseUrl;
        }

        const mcpPayload = await fetchMcpPresets(token, base);
        if (cancelled) return;
        setMcpPresets(installedMcpPresetsFromPayload(mcpPayload).filter((preset) => preset.available));
      } catch {
        if (!cancelled) {
          setMcpPresets([]);
        }
      }
    };
    loadCapabilities();

    const refreshOnFocus = () => {
      if (document.visibilityState === 'hidden') return;
      void loadCapabilities();
      void refreshDiscovery();
    };
    const refreshOnMcpPresetsChanged = (event: Event) => {
      const payload = (event as CustomEvent<unknown>).detail;
      if (isMcpPresetsPayload(payload)) {
        setMcpPresets(installedMcpPresetsFromPayload(payload).filter((preset) => preset.available));
        return;
      }
      void loadCapabilities();
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
    window.addEventListener(MCP_PRESETS_CHANGED_EVENT, refreshOnMcpPresetsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
      window.removeEventListener(MCP_PRESETS_CHANGED_EVENT, refreshOnMcpPresetsChanged);
    };
  }, [refreshDiscovery]);

  const activeProjectPath = visibleProjectPath(workspaceScope?.project_path ?? activeConv?.workspaceScope?.project_path ?? activeConv?.workspacePath ?? localWorkspace);
  const activeProjectSkillNames = activeProjectPath ? projectSkillBindings[normalizeProjectPath(activeProjectPath)] ?? [] : [];
  const usableSkills = useMemo(
    () => usableSkillsForScope(skills, activeProjectPath, activeProjectSkillNames),
    [activeProjectPath, activeProjectSkillNames, skills],
  );

  // `@` opens the connector (MCP) picker; `/` opens the skill picker.
  const suggestionType = useMemo((): 'mention' | 'skill' | null => {
    const trimmed = text.trim();
    if (trimmed.startsWith('@')) return 'mention';
    if (trimmed.startsWith('/')) return 'skill';
    return null;
  }, [text]);

  // Slash command and capability suggestions.
  const skillPickerOpen = showPlusMenu || suggestionType === 'skill';
  useEffect(() => {
    if (skillPickerOpen) void refreshDiscovery();
  }, [skillPickerOpen, refreshDiscovery]);

  const suggestions = useMemo((): SuggestionItem[] => {
    const trimmed = text.trim();

    // Connector (MCP) selection when typing @
    if (suggestionType === 'mention') {
      const query = trimmed.slice(1).toLowerCase();
      const mcpItems: SuggestionItem[] = mcpPresets
        .filter((preset) => {
          if (
            selectedMcpPresets.some((selected) => selected.name === preset.name)
            || boundMcpPresets.some((bound) => bound.name === preset.name)
          ) return false;
          if (!query) return true;
          return preset.name.toLowerCase().includes(query)
            || preset.display_name.toLowerCase().includes(query)
            || preset.description.toLowerCase().includes(query);
        })
        .map((preset) => ({
          name: preset.name,
          description: preset.description || preset.display_name,
          detail: preset.display_name,
          kind: 'mcp' as const,
          mcpPreset: preset,
        }));
      return mcpItems;
    }

    // Skill selection when typing /
    if (suggestionType === 'skill') {
      const query = trimmed.slice(1).toLowerCase();
      return usableSkills
        .filter((skill) => {
          if (selectedSkills.some((selected) => selected === skill.name)) return false;
          if (!query) return true;
          return skill.name.toLowerCase().includes(query)
            || displaySkillName(skill.name).toLowerCase().includes(query)
            || (skill.description ?? '').toLowerCase().includes(query);
        })
        .map((skill) => ({
          name: `/${displaySkillName(skill.name)}`,
          description: skill.description || displaySkillName(skill.name),
          detail: skill.name,
          kind: 'skill' as const,
          skillName: skill.name,
        }));
    }
    return [];
  }, [boundMcpPresets, text, suggestionType, mcpPresets, selectedMcpPresets, usableSkills, selectedSkills]);

  // Reset dismissed state when suggestions change
  useEffect(() => {
    setSuggestionsDismissed(false);
    if (suggestionType !== null && suggestions.length > 0) setSelectedIndex(0);
  }, [suggestionType, suggestions.length]);

  // Derived: show suggestions when there are matches and not dismissed
  const showSuggestions = !suggestionsDismissed && suggestionType !== null && suggestions.length > 0;

  // Auto-resize textarea
  const maxHeight = 160;
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      const contentHeight = el.scrollHeight;
      el.style.height = Math.min(contentHeight, maxHeight) + 'px';
      el.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
    }
  }, [text, maxHeight]);

  // Keep the highlighted suggestion visible while navigating with arrows.
  const selectedSuggestionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedSuggestionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, showSuggestions]);

  const applySuggestion = (item: SuggestionItem) => {
    if (item.kind === 'cli' && item.cliApp) {
      setSelectedCliApps((prev) => [...prev, {
        name: item.cliApp!.name,
        display_name: item.cliApp!.display_name,
        category: item.cliApp!.category,
        entry_point: item.cliApp!.entry_point,
        logo_url: item.cliApp!.logo_url,
        brand_color: item.cliApp!.brand_color,
      }]);
    } else if (item.kind === 'mcp' && item.mcpPreset) {
      setSelectedMcpPresets((prev) => [...prev, {
        name: item.mcpPreset!.name,
        display_name: item.mcpPreset!.display_name,
        category: item.mcpPreset!.category,
        transport: item.mcpPreset!.transport,
        status: item.mcpPreset!.status,
        configured: item.mcpPreset!.configured,
        logo_url: item.mcpPreset!.logo_url,
        brand_color: item.mcpPreset!.brand_color,
      }]);
    } else if (item.kind === 'skill' && item.skillName) {
      setSelectedSkills((prev) => [...prev, item.skillName!]);
    } else if (item.kind === 'slash' && item.slashCommand) {
      setText(`${item.slashCommand.command}${item.slashCommand.argHint ? ' ' : ''}`);
      setSuggestionsDismissed(true);
      textareaRef.current?.focus();
      return;
    }
    setText('');
    setSuggestionsDismissed(true);
    textareaRef.current?.focus();
  };

  const resetInput = () => {
    setSelectedPresentation(undefined);
    setText('');
    setImages([]);
    setFiles([]);
    setSelectedSkills([]);
    setSelectedCliApps([]);
    setSelectedMcpPresets([]);
    setSuggestionsDismissed(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.overflowY = 'hidden';
    }
  };

  const submitDraft = (draft: ComposerDraft, workspacePath?: string | null): boolean => {
    const trimmed = draft.text?.trim() ?? '';
    // Build file context prefix
    const fileContext = draft.files?.length
      ? [
        LEGACY_LOCAL_FILE_CONTEXT_HEADER,
        ...draft.files.map((f) => `- ${f.name}: ${f.path}`),
      ].join('\n')
      : '';

    // CLI apps still use an explicit text mention for their command adapter.
    // MCP connectors are carried by structured metadata and already render as
    // attachment chips, so repeating them in the user-visible body is redundant.
    // Skills follow the same rule: explicit skills travel via skill_scope and
    // render as chips — no /skill prefix in the message body.
    const cliAppMentions = draft.cliApps?.map((app) => `@${app.name}`).join(' ') ?? '';

    const projectPath = visibleProjectPath(workspacePath ?? workspaceScope?.project_path ?? localWorkspace);
    const usableSkillNames = usableSkillsForScope(
      skills,
      projectPath,
      projectPath ? projectSkillBindings[normalizeProjectPath(projectPath)] ?? [] : [],
    ).map((skill) => skill.name);
    const projectSkills = filterAvailableSkillNames(
      projectPath ? projectSkillBindings[normalizeProjectPath(projectPath)] ?? [] : [],
      usableSkillNames,
    );
    const explicitSkills = filterAvailableSkillNames(draft.skills ?? [], usableSkillNames);

    // Compose parts, then join with newline
    const cleanText = stripUnavailableLeadingSkillMentions(trimmed, usableSkillNames);
    const bodyParts = [fileContext, cliAppMentions, cleanText].filter(Boolean).join('\n');

    const message = bodyParts;

    return onSend(
      message,
      draft.images?.length ? draft.images : undefined,
      isWelcome ? workspacePath ?? localWorkspace : undefined,
      {
        ...(draft.presentation ? { presentation: draft.presentation } : {}),
        ...(draft.cliApps?.length ? { cliApps: draft.cliApps } : {}),
        ...(draft.mcpPresets?.length ? { mcpPresets: draft.mcpPresets } : {}),
        ...(selectedExpertTeam ? { expertTeam: selectedExpertTeam } : {}),
        skillScope: {
          project_bound_user_skills: projectSkills,
          explicit_skills: explicitSkills,
        },
      },
    ) !== false;
  };

  const currentDraft = (): ComposerDraft => ({
    presentation: selectedPresentation,
    text,
    images,
    files,
    skills: selectedSkills,
    cliApps: selectedCliApps,
    mcpPresets: selectedMcpPresets,
  });

  const stopVoiceInputForSend = () => {
    if (voiceTimeoutRef.current) {
      clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = null;
    }
    const recorder = voiceRecorderRef.current;
    voiceRecorderRef.current = null;
    void recorder?.cancel();
    const streamId = voiceStreamIdRef.current;
    if (streamId) getNanobotClient().cancelVoiceStream?.(streamId);
    voiceStreamIdRef.current = null;
    voiceStreamModeRef.current = null;
    voiceFinalizingStreamRef.current = null;
    voicePendingChunksRef.current = [];
    // The current visible transcript is already captured in `currentDraft`.
    // Drop the voice draft so late provider events cannot write into the next message.
    voiceDraftRef.current = null;
    setVoiceState('idle');
    setVoiceElapsedSec(0);
  };

  const handleSend = () => {
    const draft = currentDraft();
    if (!hasDraftPayload(draft) || disabled || sendDisabled) return;
    if (
      voiceState !== 'idle'
      || voiceRecorderRef.current
      || voiceStreamIdRef.current
    ) {
      stopVoiceInputForSend();
    }
    if (isStreaming) {
      setQueuedPrompts((items) => [
        ...items,
        {
          id: `queued-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          ...draft,
        },
      ].slice(0, QUEUED_PROMPTS_LIMIT));
      resetInput();
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    if (!submitDraft(draft)) return;
    isSubmittingRef.current = true;
    writeDraft(draftKey, { text: '', images: [], files: [], skills: [], cliApps: [], mcpPresets: [] });
    resetInput();
  };

  const sendQueuedPrompt = useCallback((prompt: QueuedPrompt) => {
    if (!submitDraft(prompt)) return;
    setQueuedPrompts((items) => items.filter((item) => item.id !== prompt.id));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [submitDraft]);

  const editQueuedPrompt = useCallback((prompt: QueuedPrompt) => {
    setQueuedPrompts((items) => items.filter((item) => item.id !== prompt.id));
    setText(prompt.text ?? '');
    setImages(prompt.images ?? []);
    setFiles(prompt.files ?? []);
    setSelectedSkills(prompt.skills ?? []);
    setSelectedCliApps(prompt.cliApps ?? []);
    setSelectedMcpPresets(prompt.mcpPresets ?? []);
    setSelectedPresentation(prompt.presentation);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(prompt.text?.length ?? 0, prompt.text?.length ?? 0);
    });
  }, []);

  const deleteQueuedPrompt = useCallback((id: string) => {
    setQueuedPrompts((items) => items.filter((item) => item.id !== id));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const sendNextQueuedPrompt = useCallback(() => {
    const nextPrompt = queuedPrompts.find((prompt) => hasDraftPayload(prompt));
    if (!nextPrompt) {
      setQueuedPrompts([]);
      return;
    }
    sendQueuedPrompt(nextPrompt);
  }, [queuedPrompts, sendQueuedPrompt]);

  useEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = isStreaming;
    if (!wasStreaming || isStreaming || queuedPrompts.length === 0) return;
    if (skipNextQueuedFlushRef.current) {
      skipNextQueuedFlushRef.current = false;
      return;
    }
    sendNextQueuedPrompt();
  }, [isStreaming, queuedPrompts.length, sendNextQueuedPrompt]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing && e.keyCode !== 229)) {
        e.preventDefault();
        applySuggestion(suggestions[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSuggestionsDismissed(true);
        return;
      }
    }
    // Backspace with empty text removes selected capabilities.
    if (e.key === 'Backspace' && text === '') {
      if (selectedMcpPresets.length > 0) {
        e.preventDefault();
        setSelectedMcpPresets((prev) => prev.slice(0, -1));
        return;
      }
      if (selectedCliApps.length > 0) {
        e.preventDefault();
        setSelectedCliApps((prev) => prev.slice(0, -1));
        return;
      }
      if (selectedSkills.length > 0) {
        e.preventDefault();
        setSelectedSkills((prev) => prev.slice(0, -1));
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      // Standard IME check
      if (isComposing || (e.nativeEvent as any).isComposing || e.keyCode === 229) {
        return;
      }

      // Buffer for macOS race conditions where compositionend fires just before keydown
      if (Date.now() - lastCompositionEndTimeRef.current < 100) {
        return;
      }

      e.preventDefault();
      handleSend();
    }
  };

  const handleAttach = useCallback(async () => {
    const selected = await dialogBridge.open({ multiple: true, directory: false });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      await processFilePaths(
        paths,
        (imgs) => setImages((prev) => [...prev, ...imgs].slice(0, MAX_IMAGES_PER_MESSAGE)),
        (items) => setFiles((prev) => [...prev, ...items]),
      );
      textareaRef.current?.focus();
    }
  }, []);

  const clearVoiceTimeout = () => {
    if (voiceTimeoutRef.current) {
      clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = null;
    }
  };

  const writeVoiceDraft = (transcript: string) => {
    const clean = transcript.trim();
    if (!clean) return;
    const draft = voiceDraftRef.current;
    if (!draft) return;
    draft.latest = clean;
    const before = draft.originalText.slice(0, draft.start);
    const after = draft.originalText.slice(draft.end);
    setText(`${before}${clean}${after}`);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const cursor = draft.start + clean.length;
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  const commitVoiceTranscript = (transcript: string) => {
    writeVoiceDraft(transcript);
    voiceDraftRef.current = null;
  };

  const restoreVoiceDraft = () => {
    const draft = voiceDraftRef.current;
    if (!draft) return;
    setText(draft.originalText);
    voiceDraftRef.current = null;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(draft.start, draft.end);
    });
  };

  const failRealtimeVoiceInput = async (message: string) => {
    const recorder = voiceRecorderRef.current;
    voiceRecorderRef.current = null;
    clearVoiceTimeout();
    await recorder?.cancel();
    const retained = voiceDraftRef.current?.latest.trim();
    if (retained) {
      commitVoiceTranscript(retained);
    } else {
      restoreVoiceDraft();
    }
    voiceStreamIdRef.current = null;
    voiceStreamModeRef.current = null;
    voiceFinalizingStreamRef.current = null;
    voicePendingChunksRef.current = [];
    setVoiceState('idle');
    setVoiceElapsedSec(0);
    addToast({
      type: retained ? 'info' : 'error',
      title: retained
        ? (isEn ? 'Voice connection ended' : '语音连接已中断')
        : (isEn ? 'Voice input failed' : '语音识别失败'),
      message: retained
        ? (isEn ? 'Recognized text was kept in the input.' : '已识别的文字已保留在输入框中。')
        : message,
      duration: 5000,
    });
  };

  const transcribeVoiceRecording = async (recording: VoiceRecordingResult) => {
    setVoiceState('transcribing');
    try {
      const transcript = await getNanobotClient().transcribeAudio(
        recording.dataUrl,
        recording.durationMs,
      );
      commitVoiceTranscript(transcript);
    } catch (error) {
      restoreVoiceDraft();
      if (error instanceof TranscriptionRequestError && error.detail === 'not_configured') {
        addToast({
          type: 'info',
          title: isEn ? 'Voice input is not configured' : '语音输入尚未配置',
          message: isEn
            ? 'Configure a default ASR model and credentials in Settings → Voice.'
            : '请在“系统设置 → 语音设置”中配置默认 ASR 模型和密钥。',
          duration: 5000,
        });
        openSystemSettings('voice');
      } else {
        addToast({
          type: 'error',
          title: isEn ? 'Voice transcription failed' : '语音识别失败',
          message: error instanceof TranscriptionRequestError
            ? (isEn ? `ASR service error: ${error.detail}` : `ASR 服务返回：${error.detail}`)
            : error instanceof Error ? error.message : String(error),
          duration: 5000,
        });
      }
    } finally {
      setVoiceState('idle');
      setVoiceElapsedSec(0);
    }
  };

  const stopVoiceRecording = async () => {
    const recorder = voiceRecorderRef.current;
    if (!recorder) return;
    voiceRecorderRef.current = null;
    clearVoiceTimeout();
    const streamId = voiceStreamIdRef.current;
    const streamMode = voiceStreamModeRef.current;
    const client = getNanobotClient();
    setVoiceState(streamMode === 'realtime' ? 'finalizing' : 'transcribing');
    let recording: VoiceRecordingResult | null = null;
    try {
      recording = await recorder.stop();
      if (recording.durationMs < 250) {
        throw new Error('recording_too_short');
      }
      if (
        streamId
        && streamMode === 'realtime'
        && typeof client.stopVoiceStream === 'function'
      ) {
        voiceFinalizingStreamRef.current = streamId;
        const transcript = await client.stopVoiceStream(streamId);
        commitVoiceTranscript(transcript);
        setVoiceState('idle');
        setVoiceElapsedSec(0);
      } else {
        if (streamId && typeof client.cancelVoiceStream === 'function') {
          client.cancelVoiceStream(streamId);
        }
        await transcribeVoiceRecording(recording);
      }
    } catch (error) {
      const retained = voiceDraftRef.current?.latest.trim();
      const shouldRetryWithBatch = Boolean(
        recording
        && !retained
        && error instanceof VoiceStreamError
        && ['empty', 'connection_interrupted', 'timeout'].includes(error.detail),
      );
      if (shouldRetryWithBatch && recording) {
        voiceStreamIdRef.current = null;
        voiceStreamModeRef.current = null;
        voiceFinalizingStreamRef.current = null;
        await transcribeVoiceRecording(recording);
        return;
      }
      if (streamId && !recording) {
        client.cancelVoiceStream?.(streamId);
      }
      if (retained) {
        commitVoiceTranscript(retained);
      } else {
        restoreVoiceDraft();
      }
      setVoiceState('idle');
      setVoiceElapsedSec(0);
      addToast({
        type: retained ? 'info' : 'error',
        title: retained
          ? (isEn ? 'Voice connection ended' : '语音连接已中断')
          : (isEn ? 'Could not record audio' : '录音失败'),
        message: error instanceof Error && error.message === 'recording_too_short'
          ? (isEn ? 'The recording was too short.' : '录音时间太短，请重试。')
          : retained
            ? (isEn ? 'Recognized text was kept in the input.' : '已识别的文字已保留在输入框中。')
            : error instanceof Error ? error.message : String(error),
        duration: 4000,
      });
    } finally {
      voiceStreamIdRef.current = null;
      voiceStreamModeRef.current = null;
      if (voiceFinalizingStreamRef.current === streamId) {
        voiceFinalizingStreamRef.current = null;
      }
      voicePendingChunksRef.current = [];
    }
  };

  const toggleVoiceRecording = async () => {
    if (!voiceInputAvailable) return;
    if (voiceState === 'recording') {
      await stopVoiceRecording();
      return;
    }
    if (voiceState !== 'idle' || disabled) return;
    try {
      const microphonePermission = await mediaBridge.requestMicrophoneAccess();
      if (!microphonePermission.granted) {
        if (microphonePermission.status === 'denied') {
          void mediaBridge.openMicrophoneSettings();
        }
        addToast({
          type: 'error',
          title: isEn ? 'Microphone access is required' : '需要麦克风权限',
          message: microphonePermission.development && microphonePermission.status === 'denied'
            ? (
              isEn
                ? 'In development, macOS may assign microphone permission to the IDE or terminal that launched Electron. Enable microphone access for that host app (for example Antigravity IDE or Terminal), then try again.'
                : '开发模式下，macOS 可能把麦克风权限归到启动 Electron 的 IDE 或终端。请为宿主应用（例如 Antigravity IDE 或“终端”）开启麦克风权限后重试。'
            )
            : microphonePermission.status === 'restricted'
              ? (
                isEn
                  ? 'Microphone access is restricted by system policy.'
                  : '麦克风权限受到系统策略限制，请联系设备管理员。'
              )
              : (
                isEn
                  ? 'Allow access in Privacy & Security → Microphone, then click the microphone again.'
                  : '请在“隐私与安全性 → 麦克风”中允许访问，然后再次点击麦克风。'
              ),
          duration: 6000,
        });
        return;
      }
      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? text.length;
      const end = textarea?.selectionEnd ?? start;
      voiceDraftRef.current = {
        originalText: text,
        start,
        end,
        latest: '',
      };
      const client = getNanobotClient();
      const streamId = globalThis.crypto?.randomUUID?.()
        ?? `voice_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      voiceStreamIdRef.current = streamId;
      voiceStreamModeRef.current = null;
      voiceFinalizingStreamRef.current = null;
      voicePendingChunksRef.current = [];
      setVoiceState('connecting');

      const streamStart = typeof client.startVoiceStream === 'function'
        ? client.startVoiceStream(streamId, {
          onState: (state) => {
            if (voiceStreamIdRef.current !== streamId) return;
            if (state === 'finalizing') setVoiceState('finalizing');
          },
          onPartial: (draft) => {
            if (voiceStreamIdRef.current !== streamId) return;
            writeVoiceDraft(draft);
          },
          onError: (error) => {
            if (
              voiceStreamIdRef.current !== streamId
              || voiceStreamModeRef.current !== 'realtime'
              || voiceFinalizingStreamRef.current === streamId
            ) return;
            void failRealtimeVoiceInput(error.message);
          },
        })
        : Promise.resolve<VoiceStreamMode>('batch');
      const recorder = await startPcmVoiceRecorder({
        chunkMs: 40,
        onChunk: (chunk) => {
          if (voiceStreamIdRef.current !== streamId) return;
          if (voiceStreamModeRef.current === 'realtime') {
            client.appendVoiceAudio?.(
              streamId,
              chunk.pcm16,
              chunk.sequence,
              chunk.durationMs,
            );
          } else if (voiceStreamModeRef.current === null) {
            voicePendingChunksRef.current.push(chunk);
          }
        },
      });
      voiceRecorderRef.current = recorder;
      const streamMode = await streamStart;
      if (voiceStreamIdRef.current !== streamId) {
        await recorder.cancel();
        return;
      }
      voiceStreamModeRef.current = streamMode;
      if (streamMode === 'realtime') {
        for (const chunk of voicePendingChunksRef.current) {
          client.appendVoiceAudio?.(
            streamId,
            chunk.pcm16,
            chunk.sequence,
            chunk.durationMs,
          );
        }
      }
      voicePendingChunksRef.current = [];
      voiceStartedAtRef.current = Date.now();
      setVoiceElapsedSec(0);
      setVoiceState('recording');
      voiceTimeoutRef.current = setTimeout(() => {
        void stopVoiceRecording();
      }, Math.max(1, Math.min(600, voiceMaxDurationSec)) * 1000);
    } catch (error) {
      const streamId = voiceStreamIdRef.current;
      if (streamId) getNanobotClient().cancelVoiceStream?.(streamId);
      await voiceRecorderRef.current?.cancel();
      voiceRecorderRef.current = null;
      voiceStreamIdRef.current = null;
      voiceStreamModeRef.current = null;
      voiceFinalizingStreamRef.current = null;
      voicePendingChunksRef.current = [];
      restoreVoiceDraft();
      setVoiceState('idle');
      const denied = error instanceof DOMException && (
        error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError'
      );
      addToast({
        type: 'error',
        title: isEn ? 'Microphone unavailable' : '无法使用麦克风',
        message: denied
          ? (isEn ? 'Allow microphone access in system settings and try again.' : '请在系统设置中允许 TP Cowork 访问麦克风后重试。')
          : error instanceof Error ? error.message : String(error),
        duration: 5000,
      });
    }
  };

  useEffect(() => {
    if (voiceState !== 'recording') return;
    const timer = setInterval(() => {
      setVoiceElapsedSec(Math.floor((Date.now() - voiceStartedAtRef.current) / 1000));
    }, 250);
    return () => clearInterval(timer);
  }, [voiceState]);

  useEffect(() => () => {
    clearVoiceTimeout();
    void voiceRecorderRef.current?.cancel();
    voiceRecorderRef.current = null;
    const streamId = voiceStreamIdRef.current;
    if (streamId) getNanobotClient().cancelVoiceStream?.(streamId);
    voiceStreamIdRef.current = null;
    voiceFinalizingStreamRef.current = null;
  }, []);

  const updateSelectedExpertTeam = (team: ExpertTeamBinding | null) => {
    if (!activeConv?.id) {
      setPendingExpertTeam(team);
      textareaRef.current?.focus();
      return;
    }
    const chatId = activeConv.id;
    setExpertTeamUpdating(true);
    void Promise.resolve()
      .then(() => getNanobotClient().setExpertTeam(chatId, team))
      .then((confirmedTeam) => {
        setConversationExpertTeam(chatId, confirmedTeam);
        textareaRef.current?.focus();
      })
      .catch((error) => {
        addToast({
          type: 'error',
          title: team
            ? (isEn ? 'Failed to select expert team' : '选择专家团队失败')
            : (isEn ? 'Failed to remove expert team' : '取消专家团队失败'),
          message: error instanceof Error ? error.message : String(error),
          duration: 5000,
        });
      })
      .finally(() => setExpertTeamUpdating(false));
  };

  const updateBoundMcpPresets = (presets: OutboundMcpPresetMention[]) => {
    if (!activeConv?.id || isRunning || mcpPresetsUpdating) return;
    const chatId = activeConv.id;
    setMcpPresetsUpdating(true);
    void Promise.resolve()
      .then(() => getNanobotClient().setMcpPresets(chatId, presets))
      .then((confirmedPresets) => {
        setConversationMcpPresets(chatId, confirmedPresets);
        textareaRef.current?.focus();
      })
      .catch((error) => {
        addToast({
          type: 'error',
          title: isEn ? 'Failed to update connectors' : '更新会话连接器失败',
          message: error instanceof Error ? error.message : String(error),
          duration: 5000,
        });
      })
      .finally(() => setMcpPresetsUpdating(false));
  };

  const removeBoundMcpPreset = (name: string) => {
    updateBoundMcpPresets(boundMcpPresets.filter((preset) => preset.name !== name));
  };

  const renderPlusMenu = () => {
    const filteredExpertTeams = expertTeams.filter((team) => {
      const query = expertTeamSearchQuery.trim().toLowerCase();
      if (!query) return true;
      return team.name.toLowerCase().includes(query)
        || team.description.toLowerCase().includes(query)
        || team.tags.some((tag) => tag.toLowerCase().includes(query));
    });
    const filteredSkills = usableSkills.filter((skill) => {
      const query = skillSearchQuery.trim().toLowerCase();
      if (!query) return true;
      return skill.name.toLowerCase().includes(query) || (skill.description ?? '').toLowerCase().includes(query);
    });
    const filteredMcpPresets = mcpPresets.filter((preset) => {
      const query = connectorSearchQuery.trim().toLowerCase();
      if (!query) return true;
      return preset.name.toLowerCase().includes(query)
        || (preset.display_name ?? '').toLowerCase().includes(query)
        || (preset.description ?? '').toLowerCase().includes(query);
    });

    return (
      <div
        ref={plusMenuRef}
        className={cn(
          "absolute left-0 w-64 bg-white rounded-2xl border border-[#dedbd3] shadow-lg py-1.5 z-50 text-[13px] duration-150 animate-in fade-in",
          isWelcome
            ? "top-full mt-2 slide-in-from-top-2"
            : "bottom-full mb-2 slide-in-from-bottom-2"
        )}
      >
        {/* Add files or photos */}
        <button
          onClick={() => {
            void handleAttach();
            setShowPlusMenu(false);
          }}
          className="w-full flex items-center justify-between px-3.5 py-2.5 text-[#29261b] hover:bg-[#f5f3ee] transition-colors text-left font-medium cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <Paperclip className="h-4 w-4 text-[#656358]" />
            <span>{isEn ? 'Add files' : '添加文件'}</span>
          </div>
          <span className="text-[#8a867c] text-[11px] font-sans">⌘U</span>
        </button>


        {/* Expert teams */}
        <div
          data-plus-menu-item="expert-team"
          className="relative"
          onMouseEnter={() => setActiveSubmenu('expert-team')}
          onMouseLeave={() => setActiveSubmenu(null)}
        >
          <button
            className={cn(
              "w-full flex items-center justify-between px-3.5 py-2.5 text-[#29261b] hover:bg-[#f5f3ee] transition-colors text-left font-medium cursor-pointer",
              activeSubmenu === 'expert-team' && "bg-[#f5f3ee]"
            )}
          >
            <div className="flex items-center gap-2.5">
              <Users className="h-4 w-4 text-[#656358]" />
              <span>{isEn ? 'Expert teams' : '专家团队'}</span>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-[#8a867c]" />
          </button>

          {activeSubmenu === 'expert-team' && (
            <div className="absolute left-full bottom-0 w-72 bg-white rounded-2xl border border-[#dedbd3] shadow-lg py-1.5 z-50 animate-in fade-in slide-in-from-left-1 duration-150">
              <div className="px-3.5 py-1.5 border-b border-[#f0ede6] flex items-center gap-2">
                <Search className="h-4 w-4 text-[#8a867c] shrink-0" />
                <input
                  type="text"
                  placeholder={isEn ? 'Search expert teams' : '搜索专家团队'}
                  value={expertTeamSearchQuery}
                  onChange={(event) => setExpertTeamSearchQuery(event.target.value)}
                  className="w-full bg-transparent text-[13px] border-none outline-none placeholder:text-[#8a867c] text-[#29261b] font-medium"
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </div>
              {expertTeamsLoading ? (
                <div className="px-3.5 py-3 text-[#8a867c] text-center">
                  {isEn ? 'Loading expert teams…' : '正在加载专家团队…'}
                </div>
              ) : expertTeamsError ? (
                <div className="px-3.5 py-3 text-[#a56f4f] text-center line-clamp-2" title={expertTeamsError}>
                  {isEn ? 'Failed to load expert teams' : '专家团队加载失败'}
                </div>
              ) : expertTeams.length === 0 ? (
                <div className="px-3.5 py-3 text-[#8a867c] italic text-center">
                  {isEn ? 'No expert teams available' : '无可用专家团队'}
                </div>
              ) : filteredExpertTeams.length === 0 ? (
                <div className="px-3.5 py-3 text-[#8a867c] italic text-center">
                  {isEn ? 'No expert teams found' : '未找到专家团队'}
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  {filteredExpertTeams.map((team) => {
                    const isSelected = selectedExpertTeam?.id === team.id;
                    return (
                      <button
                        key={team.id}
                        disabled={!team.available || expertTeamUpdating || !!selectedPresentation}
                        title={selectedPresentation ? (isEn ? 'Presentations use regular conversations' : '演示文稿需在普通会话中制作') : !team.available ? team.unavailable_reason : undefined}
                        onClick={() => {
                          const binding: ExpertTeamBinding = {
                            id: team.id,
                            name: team.name,
                            version: team.version,
                            member_count: team.member_count,
                          };
                          updateSelectedExpertTeam(binding);
                          setShowPlusMenu(false);
                          setActiveSubmenu(null);
                          textareaRef.current?.focus();
                        }}
                        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 hover:bg-[#f5f3ee] transition-colors text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <div className="flex min-w-0 items-start gap-2.5">
                          <ExpertTeamIcon
                            teamId={team.id}
                            className="mt-0.5 h-4 w-4 text-[#656358]"
                          />
                          <div className="min-w-0 flex flex-col">
                            <span className="font-medium text-[#29261b] truncate">{team.name}</span>
                            <span className="text-[11px] text-[#8a867c] line-clamp-1">
                              {team.member_count} {isEn ? 'experts' : '位专家'} · {team.description}
                            </span>
                          </div>
                        </div>
                        {isSelected && <Check className="h-3.5 w-3.5 text-[#d97757] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {SHOW_PRESENTATION_PLUS_MENU_ENTRY && (
          <button
            data-plus-menu-item="presentation"
            disabled={!!selectedExpertTeam}
            title={selectedExpertTeam ? (isEn ? 'Start a regular conversation for presentations' : '演示文稿需在普通会话中制作') : undefined}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left font-medium text-[#29261b] hover:bg-[#f5f3ee] disabled:opacity-50"
            onClick={() => { setShowPlusMenu(false); setActiveSubmenu(null); setShowPresentationPicker(true); }}
          ><Presentation className="h-4 w-4 text-[#656358]" />{isEn ? 'Create presentation' : '制作演示文稿'}</button>
        )}

        {/* Skills */}
        <div
          data-plus-menu-item="skills"
          className="relative"
          onMouseEnter={() => setActiveSubmenu('skills')}
          onMouseLeave={() => setActiveSubmenu(null)}
        >
          <button
            className={cn(
              "w-full flex items-center justify-between px-3.5 py-2.5 text-[#29261b] hover:bg-[#f5f3ee] transition-colors text-left font-medium cursor-pointer",
              activeSubmenu === 'skills' && "bg-[#f5f3ee]"
            )}
          >
            <div className="flex items-center gap-2.5">
              <GraduationCap className="h-4 w-4 text-[#656358]" />
              <span>{isEn ? 'Skills' : '技能'}</span>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-[#8a867c]" />
          </button>

          {activeSubmenu === 'skills' && (
            <div className={cn(
              "absolute left-full bottom-0 w-64 bg-white rounded-2xl border border-[#dedbd3] shadow-lg py-1.5 z-50 animate-in fade-in slide-in-from-left-1 duration-150"
            )}>
              <div className="px-3.5 py-1.5 border-b border-[#f0ede6] flex items-center gap-2">
                <Search className="h-4 w-4 text-[#8a867c] shrink-0" />
                <input
                  type="text"
                  placeholder={isEn ? 'Search skills' : '搜索技能'}
                  value={skillSearchQuery}
                  onChange={(event) => setSkillSearchQuery(event.target.value)}
                  className="w-full bg-transparent text-[13px] border-none outline-none placeholder:text-[#8a867c] text-[#29261b] font-medium"
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </div>
              {usableSkills.length === 0 ? (
                <div className="px-3.5 py-2 text-[#8a867c] italic text-center">
                  {isEn ? 'No skills available' : '无可用技能'}
                </div>
              ) : filteredSkills.length === 0 ? (
                <div className="px-3.5 py-2 text-[#8a867c] italic text-center">
                  {isEn ? 'No skills found' : '未找到技能'}
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto">
                  {filteredSkills.map((skill) => {
                    const isSelected = selectedSkills.includes(skill.name);
                    return (
                      <button
                        key={skill.name}
                        onClick={() => {
                          setSelectedSkills((prev) => (
                            prev.includes(skill.name)
                              ? prev.filter((name) => name !== skill.name)
                              : [...prev, skill.name]
                          ));
                          textareaRef.current?.focus();
                        }}
                        className="w-full flex items-center justify-between gap-2 px-3.5 py-2 hover:bg-[#f5f3ee] transition-colors text-left cursor-pointer"
                      >
                        <div className="min-w-0 flex flex-col">
                          <span className="font-medium text-[#29261b] truncate">/{displaySkillName(skill.name)}</span>
                          <span className="text-[11px] text-[#8a867c] line-clamp-1">{skill.description}</span>
                        </div>
                        {isSelected && <Check className="h-3.5 w-3.5 text-[#d97757] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Add connector */}
        <div
          data-plus-menu-item="connector"
          className="relative"
          onMouseEnter={() => setActiveSubmenu('connector')}
          onMouseLeave={() => setActiveSubmenu(null)}
        >
          <button
            className={cn(
              "w-full flex items-center justify-between px-3.5 py-2.5 text-[#29261b] hover:bg-[#f5f3ee] transition-colors text-left font-medium cursor-pointer",
              activeSubmenu === 'connector' && "bg-[#f5f3ee]"
            )}
          >
            <div className="flex items-center gap-2.5">
              <Puzzle className="h-4 w-4 text-[#656358]" />
              <span>{isEn ? 'Add connector' : '添加连接器'}</span>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-[#8a867c]" />
          </button>

          {activeSubmenu === 'connector' && (
            <div className={cn(
              "absolute left-full bottom-0 w-64 bg-white rounded-2xl border border-[#dedbd3] shadow-lg py-1.5 z-50 animate-in fade-in slide-in-from-left-1 duration-150"
            )}>
              <div className="px-3.5 py-1.5 border-b border-[#f0ede6] flex items-center gap-2">
                <Search className="h-4 w-4 text-[#8a867c] shrink-0" />
                <input
                  type="text"
                  placeholder={isEn ? 'Search connectors' : '搜索连接器'}
                  value={connectorSearchQuery}
                  onChange={(event) => setConnectorSearchQuery(event.target.value)}
                  className="w-full bg-transparent text-[13px] border-none outline-none placeholder:text-[#8a867c] text-[#29261b] font-medium"
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </div>
              {mcpPresets.length === 0 ? (
                <div className="px-3.5 py-2 text-[#8a867c] italic text-center">
                  {isEn ? 'No connectors available' : '无可用连接器'}
                </div>
              ) : filteredMcpPresets.length === 0 ? (
                <div className="px-3.5 py-2 text-[#8a867c] italic text-center">
                  {isEn ? 'No connectors found' : '未找到连接器'}
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto">
                  {filteredMcpPresets.map((preset) => {
                    const isBound = boundMcpPresets.some((item) => item.name === preset.name);
                    const isSelected = isBound || selectedMcpPresets.some((s) => s.name === preset.name);
                    return (
                      <button
                        key={preset.name}
                        disabled={isBound && (isRunning || mcpPresetsUpdating)}
                        onClick={() => {
                          if (isBound) {
                            removeBoundMcpPreset(preset.name);
                          } else if (isSelected) {
                            setSelectedMcpPresets((prev) => prev.filter((p) => p.name !== preset.name));
                          } else {
                            setSelectedMcpPresets((prev) => [...prev, {
                              name: preset.name,
                              display_name: preset.display_name,
                              category: preset.category,
                              transport: preset.transport,
                              status: preset.status,
                              configured: preset.configured,
                              logo_url: preset.logo_url,
                              brand_color: preset.brand_color,
                            }]);
                          }
                          setShowPlusMenu(false);
                          setActiveSubmenu(null);
                          textareaRef.current?.focus();
                        }}
                        className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-[#f5f3ee] transition-colors text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium text-[#29261b] truncate">@{preset.display_name || preset.name}</span>
                          <span className="text-[11px] text-[#8a867c] line-clamp-1 truncate">{preset.description}</span>
                        </div>
                        {isSelected && <Check className="h-3.5 w-3.5 text-[#d97757] shrink-0 ml-2" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-[#f0ede6] my-1.5" />

        {/* Web search */}
        <button
          onClick={() => {
            setUseBuiltinWebSearch(!useBuiltinWebSearch);
          }}
          className="w-full flex items-center justify-between px-3.5 py-2.5 text-[#29261b] hover:bg-[#f5f3ee] transition-colors text-left font-medium cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <Globe className="h-4 w-4 text-[#656358]" />
            <span>{isEn ? 'Web search' : '网络搜索'}</span>
          </div>
          {useBuiltinWebSearch && <Check className="h-4 w-4 text-[#d97757]" />}
        </button>
      </div>
    );
  };

  // Global keydown listener for Cmd/Ctrl+U
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isModifier = isMac ? e.metaKey : e.ctrlKey;
      if (isModifier && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        handleAttach();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleAttach]);

  // Close plus menu on click outside
  useEffect(() => {
    if (!showPlusMenu) {
      setExpertTeamSearchQuery('');
      setSkillSearchQuery('');
      setConnectorSearchQuery('');
    }
    if (!showPlusMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setShowPlusMenu(false);
        setActiveSubmenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPlusMenu]);

  // Close plus menu on Escape key
  useEffect(() => {
    if (!showPlusMenu) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowPlusMenu(false);
        setActiveSubmenu(null);
        setExpertTeamSearchQuery('');
        setSkillSearchQuery('');
        setConnectorSearchQuery('');
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showPlusMenu]);

  const hasAttachments = images.length > 0 || files.length > 0;
  const hasContent = text.trim().length > 0 || selectedSkills.length > 0 || selectedCliApps.length > 0 || selectedMcpPresets.length > 0 || hasAttachments;
  const showProjectSelector = !activeConv?.scheduledTaskId
    && !activeConv?.workspacePath
    && !activeConv?.workspaceScope?.project_path;
  const projectSelectorPaths = useMemo(() => {
    const seen = new Set<string>();
    const paths: string[] = [];
    const add = (path: string | null | undefined) => {
      const visible = visibleProjectPath(path);
      if (!visible || seen.has(visible)) return;
      seen.add(visible);
      paths.push(visible);
    };
    recentPaths.forEach(add);
    gatewayProjects
      .filter((project) => project.kind === 'workspace' && project.status !== 'archived')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach((project) => add(project.rootPath));
    return paths;
  }, [gatewayProjects, recentPaths]);

  // Determine placeholder based on selected command
  const placeholder = hoverPrompt
    ? hoverPrompt
    : disabled
      ? t.chat.inputPlaceholderBusy
      : isRunning
        ? t.chat.inputPlaceholderMidTask
        : t.chat.inputPlaceholder;

  const clearSelectedExpertTeam = () => {
    updateSelectedExpertTeam(null);
  };

  const renderSelectedExpertTeam = () => selectedExpertTeam ? (
    <button
      type="button"
      data-composer-action
      data-selected-expert-team={selectedExpertTeam.id}
      onClick={clearSelectedExpertTeam}
      disabled={expertTeamUpdating}
      aria-busy={expertTeamUpdating}
      title={isEn ? `Remove ${selectedExpertTeam.name || selectedExpertTeam.id}` : `取消专家团队：${selectedExpertTeam.name || selectedExpertTeam.id}`}
      aria-label={isEn ? `Remove expert team ${selectedExpertTeam.name || selectedExpertTeam.id}` : `取消专家团队 ${selectedExpertTeam.name || selectedExpertTeam.id}`}
      className="group/team inline-flex h-8 max-w-[220px] shrink-0 items-center gap-1.5 rounded-xl bg-[#f0efec] px-2.5 text-[13px] font-medium text-[#29261b] transition-colors hover:bg-[#e8e6e1] disabled:cursor-wait disabled:opacity-60"
    >
      <span className="relative h-4 w-4 shrink-0">
        <ExpertTeamIcon
          teamId={selectedExpertTeam.id}
          className="absolute inset-0 h-4 w-4 text-[#656358] transition-opacity group-hover/team:opacity-0"
        />
        <X className="absolute inset-0 h-4 w-4 text-[#656358] opacity-0 transition-opacity group-hover/team:opacity-100" />
      </span>
      <span className="truncate">{selectedExpertTeam.name || selectedExpertTeam.id}</span>
    </button>
  ) : null;

  const renderBoundMcpPresets = () => !selectedExpertTeam && boundMcpPresets.length > 0 ? (
    <div data-bound-mcp-presets className="inline-flex min-w-0 items-center gap-1.5">
      {boundMcpPresets.map((preset) => (
        <button
          type="button"
          data-composer-action
          data-bound-mcp-preset={preset.name}
          key={`bound-mcp-${preset.name}`}
          onClick={() => removeBoundMcpPreset(preset.name)}
          disabled={isRunning || mcpPresetsUpdating}
          aria-busy={mcpPresetsUpdating}
          title={isEn
            ? `Remove ${preset.display_name || preset.name} from this conversation`
            : `从当前会话移除 ${preset.display_name || preset.name}`}
          aria-label={isEn
            ? `Remove connector ${preset.display_name || preset.name}`
            : `移除连接器 ${preset.display_name || preset.name}`}
          className="group/mcp inline-flex h-8 max-w-[180px] shrink-0 items-center gap-1.5 rounded-xl bg-[#f0efec] px-2.5 text-[13px] font-medium text-[#29261b] transition-colors hover:bg-[#e8e6e1] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="relative h-4 w-4 shrink-0">
            <Puzzle className="absolute inset-0 h-4 w-4 text-[#656358] transition-opacity group-hover/mcp:opacity-0" />
            <X className="absolute inset-0 h-4 w-4 text-[#656358] opacity-0 transition-opacity group-hover/mcp:opacity-100" />
          </span>
          <span className="truncate">{preset.display_name || preset.name}</span>
        </button>
      ))}
    </div>
  ) : null;

  const renderVoiceControl = () => {
    const elapsed = `${Math.floor(voiceElapsedSec / 60)}:${String(voiceElapsedSec % 60).padStart(2, '0')}`;
    const voiceBusy = voiceState !== 'idle';
    return (
      <div className="relative flex items-center">
        <Button
          type="button"
          data-composer-action
          variant="ghost"
          size="icon"
          onClick={() => void toggleVoiceRecording()}
          disabled={disabled || (voiceBusy && voiceState !== 'recording')}
          aria-label={
            voiceState === 'recording'
              ? (isEn ? 'Stop recording' : '结束录音')
              : voiceState === 'connecting'
                ? (isEn ? 'Connecting voice input' : '正在连接语音识别')
                : voiceState === 'finalizing' || voiceState === 'transcribing'
                  ? (isEn ? 'Finalizing transcription' : '正在整理识别结果')
                  : (isEn ? 'Voice input' : '语音输入')
          }
          aria-pressed={voiceState === 'recording'}
          title={
            voiceState === 'recording'
              ? (isEn ? 'Stop recording' : '结束录音并识别')
              : voiceState === 'connecting'
                ? (isEn ? 'Connecting…' : '正在连接…')
                : voiceState === 'transcribing' || voiceState === 'finalizing'
                  ? (isEn ? 'Transcribing…' : '正在识别…')
                  : (isEn ? 'Voice input' : '语音输入')
          }
          className={cn(
            'h-8 w-8 rounded-xl transition-colors',
            voiceState === 'recording'
              ? 'bg-[#fbe9e3] text-[#d97757] ring-1 ring-inset ring-[#f0c9bb] hover:bg-[#f6ddd4] hover:text-[#c96a45]'
              : voiceState !== 'idle'
                ? 'bg-[#f5eee9] text-[#d97757]'
                : 'text-[#656358] hover:bg-[#eeeeea] hover:text-[#29261b]',
          )}
        >
          {voiceState === 'recording' ? (
            <ThinkingOrb state="listening" size={20} aria-label="" className="pointer-events-none" />
          ) : voiceState !== 'idle' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </Button>
        {voiceState === 'recording' ? (
          <span className="ml-1 min-w-9 font-mono text-[11px] font-medium tabular-nums text-[#d97757]">
            {elapsed}
          </span>
        ) : voiceState === 'connecting' ? (
          <span className="ml-1 text-[11px] font-medium text-[#d97757]">
            {isEn ? 'Connecting' : '连接中'}
          </span>
        ) : voiceState === 'finalizing' || voiceState === 'transcribing' ? (
          <span className="ml-1 text-[11px] font-medium text-[#d97757]">
            {isEn ? 'Finalizing' : '整理中'}
          </span>
        ) : null}
      </div>
    );
  };

  const renderModelPicker = () => (
    <div className="relative" ref={modelPickerRef}>
      <button
        data-codex-model-picker
        onClick={() => {
          if (!gatewayTextModelsHydrated) return;
          if (!gatewayTextModels.length) {
            openSystemSettings('ai-services');
            return;
          }
          setShowModelPicker(!showModelPicker);
        }}
        disabled={!gatewayTextModelsHydrated || switchingModelPreset !== null}
        title={activeTextModelId}
        className="btn-ghost flex items-center gap-1 px-2.5 py-1.5 text-[14px] text-[#3d3929] font-medium hover:text-[#29261b] hover:bg-[#eeeeea] rounded-lg transition-colors"
      >
        <span className="max-w-44 truncate">{modelDisplay}</span>
        {switchingModelPreset
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : <ChevronDown className={cn('h-3 w-3 transition-transform', showModelPicker && 'rotate-180')} />}
      </button>
      {showModelPicker && gatewayTextModels.length > 0 && (
        <div data-codex-model-menu className="absolute bottom-full right-0 z-50 mb-1.5 max-h-72 w-72 overflow-y-auto rounded-lg border border-[#dedbd3] bg-white py-1 shadow-lg">
          {gatewayTextModels.map((model) => (
            <button
              key={model.presetName}
              onClick={() => void selectTextModel(model.presetName)}
              disabled={switchingModelPreset !== null}
              className={cn(
                'w-full flex items-center justify-between px-3 py-1.5 text-[12px] transition-colors text-left',
                model.presetName === activeTextModelPreset
                  ? 'text-[#d97757] font-medium bg-[#d97757]/5'
                  : 'text-[#29261b] hover:bg-[#f5f3ee]'
              )}
            >
              <span className="min-w-0 truncate" title={model.model}>{modelDisplayName(model.model)}</span>
              {model.presetName === activeTextModelPreset && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-[#d97757]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const projectSelector = showProjectSelector ? (
    <div
      data-codex-project-selector
      data-welcome-project-selector={isWelcome ? 'true' : undefined}
      data-composer-project-selector-placement={isWelcome ? 'outside' : 'inside'}
      className={cn(
        'z-10 flex items-center gap-4 px-4 py-1.5 text-[12.5px] text-[#656358] select-none',
        isWelcome
          ? 'rounded-b-[20px]'
          : 'rounded-b-[24px] border-t border-[#e4e0d8]/70 bg-transparent',
      )}
    >
      <FolderSelector
        variant="pill"
        currentPath={workspaceScope?.project_path ?? localWorkspace}
        recentPaths={projectSelectorPaths}
        projectsHydrated={projectsHydrated}
        onSelect={handleSelectFolder}
        onClear={handleClearWorkspace}
      />
    </div>
  ) : null;

  return (
    <>
      {showPresentationPicker && <PresentationPicker chatId={activeConv?.id} isEnglish={isEn} onClose={() => setShowPresentationPicker(false)} onSelect={(selection) => { setSelectedPresentation(selection); textareaRef.current?.focus(); }} />}
      {/* Welcome-only: Permission Dialog */}
      {isWelcome && pendingFolder && (
        <PermissionDialog
          request={{ type: 'workspace', path: pendingFolder }}
          onAllow={handleAllowPermission}
          onDeny={handleDenyPermission}
        />
      )}

      <div
        className="relative"
        data-welcome-input-root={isWelcome ? 'true' : undefined}
      >
        {queuedPrompts.length > 0 && (
          <div className="mb-2 rounded-2xl border border-[#dedbd3] bg-white/90 p-1.5 shadow-sm dark:border-[#3a3a38] dark:bg-[#262624]/95">
            <div className="max-h-48 overflow-y-auto">
              {queuedPrompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className="group flex min-h-8 items-center gap-1.5 rounded-xl px-2 py-1 text-[13px] transition-colors hover:bg-[#f5f3ee] dark:hover:bg-[#2d2d2c]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 whitespace-pre-wrap break-words font-medium leading-snug text-[#29261b] dark:text-[#d6d2ca]">
                      {queuedPromptLabel(prompt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => sendQueuedPrompt(prompt)}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium text-[#656358] transition-colors hover:bg-[#e8e5de] hover:text-[#29261b] dark:text-[#8a867c] dark:hover:bg-[#3a3835] dark:hover:text-[#d6d2ca]"
                    title="立即发送"
                  >
                    <CornerDownRight className="h-3 w-3" />
                    发送
                  </button>
                  <button
                    type="button"
                    onClick={() => editQueuedPrompt(prompt)}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#656358] transition-colors hover:bg-[#e8e5de] hover:text-[#29261b] dark:text-[#8a867c] dark:hover:bg-[#3a3835] dark:hover:text-[#d6d2ca]"
                    title="编辑"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteQueuedPrompt(prompt.id)}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#656358] transition-colors hover:bg-[#e8e5de] hover:text-red-600 dark:text-[#8a867c] dark:hover:bg-[#3a3835] dark:hover:text-red-400"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Suggestions Popup (slash commands / capabilities) */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute bottom-full left-0 mb-1.5 z-20 w-72 overflow-hidden rounded-xl border border-[#dedbd3] bg-white shadow-[0_8px_28px_rgba(0,0,0,0.12)]">
            <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-[#8a867c]">
              {suggestionType === 'mention'
                ? (isEn ? 'Connectors' : '连接器')
                : (isEn ? 'Skills' : '技能')}
            </div>
            <div className="max-h-[220px] overflow-y-auto overscroll-contain pb-1">
              {suggestions.map((item, idx) => (
                <button
                  key={`${item.kind ?? suggestionType}-${item.name}`}
                  ref={idx === selectedIndex ? selectedSuggestionRef : undefined}
                  onClick={() => applySuggestion(item)}
                  className={cn(
                    'btn-ghost flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]',
                    idx === selectedIndex ? 'bg-[#e8e5de]' : 'hover:bg-[#f5f3ee]'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-[#29261b]">{item.name}</span>
                  <span className="max-w-[55%] shrink-0 truncate text-[11.5px] text-[#656358]">{item.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Unified Input Widget Container */}
        <div
          data-codex-composer-shell
          data-composer-variant={isWelcome ? 'welcome' : 'chat'}
          data-welcome-composer-shell={isWelcome ? 'true' : undefined}
          className={cn(
            'relative flex flex-col',
            isWelcome
              ? 'rounded-[20px] border border-[#e8e4dd] bg-[#faf9f6] shadow-[0_4px_18px_rgba(41,38,27,0.055)]'
              : 'rounded-[24px] border border-transparent bg-transparent shadow-none',
          )}
        >
          {/* Input Card */}
          <div
            data-codex-composer-card
            data-welcome-composer-card={isWelcome ? 'true' : undefined}
            data-floating-composer={isWelcome ? undefined : 'true'}
            className={cn(
              'relative border transition-[border-color,background-color,box-shadow]',
              isWelcome
                ? 'rounded-[20px] border-[#e8e5de]/60 bg-white shadow-[0_2px_8px_rgba(41,38,27,0.025)]'
                : 'rounded-[24px] border-[#d8d4cb]/80 bg-white/[0.86] shadow-[0_14px_42px_rgba(41,38,27,0.13),0_2px_8px_rgba(41,38,27,0.055)] backdrop-blur-xl backdrop-saturate-150',
              !isWelcome && isDragging
                ? 'border-[#d97757] ring-2 ring-[#d97757]/20'
                : ''
            )}
          >
            {/* Chat-only: Drag overlay */}
            {!isWelcome && isDragging && (
              <div className="absolute inset-0 flex items-center justify-center rounded-[24px] bg-[#fbfaf7]/90 z-10">
                <span className="text-sm text-[#d97757] font-medium">{t.chat.dropFilesHere}</span>
              </div>
            )}

            {/* Attachment Strip (images + file badges) */}
            {hasAttachments && (
              <div className={cn('flex items-center gap-2 overflow-x-auto', isWelcome ? 'px-5 pt-3 pb-1' : 'px-4 pt-3 pb-1')}>
                {images.map((img) => (
                  <div key={img.id} className="relative group/img shrink-0">
                    <img
                      src={`data:${img.mediaType};base64,${img.data}`}
                      alt=""
                      className="w-12 h-12 rounded-xl object-cover border border-[#dedbd3]"
                    />
                    <button
                      onClick={() => removeImage(img.id)}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#29261b] text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
                      title={t.chat.removeImage}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
                {files.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#f3f2ee] border border-[#dedbd3] shrink-0 group/file"
                  >
                    <FileText className="h-3.5 w-3.5 text-[#656358] shrink-0" />
                    <span className="text-[12px] text-[#29261b] max-w-[160px] truncate">{f.name}</span>
                    <button
                      onClick={() => removeFile(f.id)}
                      className="p-0.5 rounded hover:bg-[#e8e5de] text-[#656358] hover:text-[#29261b] transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {selectedPresentation && <div className="flex min-w-0 items-center gap-2 px-4 pt-3 text-xs" data-presentation-selection>
              <Presentation className="size-4 shrink-0 text-emerald-700" />
              <button className="min-w-0 truncate text-emerald-800" title={isEn ? 'Change presentation' : '选择模板或文稿'} onClick={() => setShowPresentationPicker(true)}>{selectedPresentation.name}{selectedPresentation.page ? ` · ${isEn ? 'Page' : '第'} ${selectedPresentation.page} ${isEn ? '' : '页'}` : ''}</button>
              <button title={isEn ? 'Remove presentation' : '移除文稿选择'} className="grid size-6 shrink-0 place-items-center rounded hover:bg-black/5" onClick={() => setSelectedPresentation(undefined)}><X className="size-3" /></button>
            </div>}
            {/* Textarea Row with inline command prefix */}
            <div className={cn(
              'flex items-start gap-0',
              isWelcome
                ? hasAttachments ? 'px-4 pt-1 pb-1' : 'px-4 pt-4 pb-0.5'
                : hasAttachments ? 'px-4 pt-1 pb-1' : 'px-4 pt-3.5 pb-1'
            )}>
              {/* Inline command prefix (unified for both variants) */}
              {selectedSkills.map((skill) => (
                <button
                  key={`selected-skill-${skill}`}
                  onClick={() => setSelectedSkills((prev) => prev.filter((item) => item !== skill))}
                  className="shrink-0 mt-[3px] mr-1.5 rounded-full bg-[#f2efe9] px-2 py-0.5 text-[12px] font-medium text-[#6b685e] hover:line-through dark:bg-[#4a4a4a] dark:text-[#e2ded5] dark:hover:bg-[#555]"
                  title={t.common.close}
                >
                  /{displaySkillName(skill)}
                </button>
              ))}
              {selectedCliApps.map((app) => (
                <button
                  key={`selected-cli-${app.name}`}
                  onClick={() => setSelectedCliApps((prev) => prev.filter((item) => item.name !== app.name))}
                  className="shrink-0 mt-[3px] mr-1.5 rounded-full bg-[#eef2ff] px-2 py-0.5 text-[12px] font-medium text-[#4f46e5] hover:line-through dark:bg-[#2e2f4a] dark:text-[#a5b4fc] dark:hover:bg-[#383a5c]"
                  title={t.common.close}
                >
                  @{app.display_name || app.name}
                </button>
              ))}
              {selectedMcpPresets.map((preset) => (
                <button
                  key={`selected-mcp-${preset.name}`}
                  onClick={() => setSelectedMcpPresets((prev) => prev.filter((item) => item.name !== preset.name))}
                  className="shrink-0 mt-[3px] mr-1.5 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[12px] font-medium text-[#047857] hover:line-through dark:bg-[#1f3a33] dark:text-[#6ee7b7] dark:hover:bg-[#26473e]"
                  title={t.common.close}
                >
                  @{preset.display_name || preset.name}
                </button>
              ))}
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => {
                  setIsComposing(false);
                  lastCompositionEndTimeRef.current = Date.now();
                }}
                placeholder={placeholder}
                disabled={disabled}
                readOnly={voiceState !== 'idle'}
                data-voice-input-state={voiceState}
                data-codex-composer-input
                data-welcome-composer-input={isWelcome ? 'true' : undefined}
                rows={isWelcome ? 2 : 1}
                className={cn(
                  'flex-1 resize-none bg-transparent font-user-message text-[#29261b] outline-none placeholder:text-[#969289]',
                  isWelcome
                    ? 'min-h-[52px] max-h-[160px] text-[16px] leading-6'
                    : 'min-h-[28px] max-h-[160px] py-0.5 text-[15px] leading-relaxed disabled:opacity-40'
                )}
              />
            </div>

            {/* Bottom Toolbar */}
            {isWelcome ? (
              /* Welcome variant: [+] + --- + Start button */
              <div data-codex-composer-toolbar data-welcome-composer-toolbar className="flex flex-wrap items-center gap-2 px-4 pb-3">
                <div className="relative">
                  <Button
                    data-composer-action
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowPlusMenu(!showPlusMenu)}
                    aria-label={t.chat.addAttachment}
                    className={cn(
                      "btn-ghost h-8 w-8 rounded-xl text-[#29261b] transition-colors hover:text-[#29261b] dark:text-[#d6d2ca] dark:hover:text-white",
                      showPlusMenu
                        ? "bg-[#eeeeea] dark:bg-[#3a3835] dark:text-white"
                        : "hover:bg-[#eeeeea] dark:hover:bg-[#2d2d2c]"
                    )}
                  >
                    <Plus className={cn("h-4 w-4 transition-transform duration-200", showPlusMenu && "rotate-45")} />
                  </Button>
                  {showPlusMenu && renderPlusMenu()}
                </div>
                {voiceInputAvailable ? renderVoiceControl() : null}
                {renderSelectedExpertTeam()}
                {renderBoundMcpPresets()}
                <div className="flex-1" />
                {renderModelPicker()}

                <button
                  data-codex-submit
                  data-codex-send-button
                  data-welcome-submit
                  onClick={handleSend}
                  disabled={!hasContent || disabled || sendDisabled}
                  aria-label={t.chat.send}
                  title={t.chat.send}
                  className="composer-send-button"
                >
                  <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.35} />
                </button>
              </div>
            ) : (
              /* Chat variant: [+] + --- + Model label + Stop/Send */
              <div data-codex-composer-toolbar className="flex flex-wrap items-center justify-between gap-y-2 px-4 pb-3 pt-1">
                {/* Left Actions */}
                <div className="flex items-center gap-0.5">
                  <div className="relative">
                    <Button
                      data-composer-action
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowPlusMenu(!showPlusMenu)}
                      aria-label={t.chat.addAttachment}
                      className={cn(
                        "btn-ghost h-8 w-8 rounded-xl text-[#29261b] transition-colors hover:text-[#29261b] dark:text-[#d6d2ca] dark:hover:text-white",
                        showPlusMenu
                          ? "bg-[#eeeeea] dark:bg-[#3a3835] dark:text-white"
                          : "hover:bg-[#eeeeea] dark:hover:bg-[#2d2d2c]"
                      )}
                    >
                      <Plus className={cn("h-4 w-4 transition-transform duration-200", showPlusMenu && "rotate-45")} />
                    </Button>
                    {showPlusMenu && renderPlusMenu()}
                  </div>
                  {voiceInputAvailable ? renderVoiceControl() : null}
                  {renderSelectedExpertTeam()}
                  {renderBoundMcpPresets()}
                </div>

                <div className="ml-auto flex items-center gap-2">
                  {/* Model picker dropdown */}
                  {renderModelPicker()}

                  {/* Send / Stop Button */}
                  {isStreaming ? (
                    <>
                      <Button
                        data-codex-submit
                        data-codex-queue-submit
                        size="icon"
                        onClick={handleSend}
                        disabled={!hasContent || disabled || sendDisabled}
                        aria-label="加入队列"
                        className={cn(
                          'h-8 w-8 rounded-[10px] transition-colors',
                          hasContent && !disabled && !sendDisabled
                            ? 'bg-[#29261b] hover:bg-[#3d3a2f] text-[#faf9f5] shadow-sm'
                            : 'bg-[#e8e5de] text-[#656358]/50 cursor-not-allowed hover:bg-[#e8e5de]',
                        )}
                        title="加入队列"
                      >
                        <CornerDownRight className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        data-codex-stop
                        size="icon"
                        onClick={handleStop}
                        disabled={isStopping}
                        aria-busy={isStopping}
                        aria-label={isStopping ? t.chat.stopping : t.chat.stop}
                        className="btn-claude-primary h-8 w-8 rounded-[10px] bg-red-500 hover:bg-red-600 text-white shadow-sm disabled:cursor-wait disabled:opacity-100"
                        title={isStopping ? t.chat.stopping : t.chat.stop}
                      >
                        {isStopping ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Square className="h-3 w-3" fill="currentColor" />
                        )}
                      </Button>
                    </>
                  ) : (
                    <Button
                      data-codex-submit
                      data-codex-send-button
                      size="icon"
                      onClick={handleSend}
                      disabled={!hasContent || disabled || sendDisabled}
                      aria-label={t.chat.send}
                      title={t.chat.send}
                      className="composer-send-button"
                    >
                      <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.35} />
                    </Button>
                  )}
                </div>
              </div>
            )}

            {!isWelcome ? projectSelector : null}
          </div>

          {isWelcome ? projectSelector : null}
        </div>



        {isWelcome && activeCategory && (
          <div
            ref={categoryPanelRef}
            data-welcome-shortcut-panel
            className="absolute bottom-full left-0 right-0 z-30 mb-2.5 overflow-hidden rounded-[20px] border border-[#dedbd3] bg-[#fffefa] shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            {/* Header */}
            {(() => {
              const category = SHORTCUT_CATEGORIES.find((c) => c.id === activeCategory);
              if (!category) return null;
              const Icon = category.icon;
              return (
                <div className="flex items-center justify-between border-b border-[#f0ede6] px-5 pb-3 pt-4 text-[13px] font-medium text-[#656358]">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-[#656358]" />
                    <span>{t.chat[category.labelKey]}</span>
                  </div>
                  <button
                    onClick={() => setActiveCategory(null)}
                    className="rounded-lg p-1 text-[#656358] transition-colors hover:bg-[#f5f3ee] hover:text-[#29261b]"
                    title={t.common.close}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })()}

            {/* Options List */}
            <div className="max-h-64 overflow-y-auto">
              {(() => {
                const category = SHORTCUT_CATEGORIES.find((c) => c.id === activeCategory);
                if (!category) return null;
                const isEn = useSettingsStore.getState().language === 'en-US';
                return category.options.map((opt, idx) => (
                  <button
                    key={opt.key}
                    onClick={() => handleShortcutOptionClick(isEn ? opt.promptEn : opt.promptZh)}
                    onMouseEnter={() => setHoverPrompt(isEn ? opt.promptEn : opt.promptZh)}
                    onMouseLeave={() => setHoverPrompt(null)}
                    className={cn(
                      "group flex w-full items-center justify-between px-5 py-3.5 text-left text-[14px] text-[#29261b] transition-colors hover:bg-[#f5f3ee]",
                      idx > 0 && "border-t border-[#f0ede6]"
                    )}
                  >
                    <span className="font-medium group-hover:text-[#d97757] transition-colors">
                      {isEn ? opt.labelEn : opt.labelZh}
                    </span>
                    <ArrowUp className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 text-[#d97757] transition-all transform translate-x-1 group-hover:translate-x-0 shrink-0 ml-2" />
                  </button>
                ));
              })()}
            </div>
          </div>
        )}

        {isWelcome && (
          <div data-welcome-shortcuts className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {SHORTCUT_CATEGORIES.map((category) => {
              const Icon = category.icon;
              return (
                <button
                  key={category.id}
                  data-welcome-shortcut={category.id}
                  data-active={activeCategory === category.id ? 'true' : 'false'}
                  onClick={() => handleShortcut(category.id)}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-[#dedbd3]/80 bg-[#fffefa] px-3 text-[13px] font-medium text-[#29261b] shadow-[0_1px_2px_rgba(41,38,27,0.08)] transition-colors hover:bg-[#f5f3ee]"
                >
                  <Icon className="h-3.5 w-3.5 text-[#656358]" />
                  <span>{t.chat[category.labelKey]}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
