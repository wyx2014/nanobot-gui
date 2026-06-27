import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Plus, ArrowUp, ArrowRight, Square, X, ChevronDown, Check, FileText, CornerDownRight, Pencil, Trash2, GraduationCap, Code, Coffee, Lightbulb, Paperclip, ChevronRight, Puzzle, Globe, Search } from 'lucide-react';
import { dialogBridge, fsBridge } from '@/lib/ipc-factory';
import { useFileDragDrop } from '@/hooks/useFileDragDrop';
import { uint8ArrayToBase64 } from '@/utils/base64';
import { getBaseName, IMAGE_MIME_MAP } from '@/utils/pathUtils';
import { isImageFile } from '@/components/chat/FileAttachment';
import { useChatStore, useActiveConversation } from '@/stores/chatStore';
import { useSettingsStore, getEffectiveModel, AVAILABLE_MODELS } from '@/stores/settingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { usePermissionStore } from '@/stores/permissionStore';
import type { PermissionDuration } from '@/stores/permissionStore';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ImageAttachment } from '@/types';
import type { OutboundCliAppMention, OutboundMcpPresetMention } from '@/core/types';
import type { CliAppInfo, McpPresetInfo, SlashCommand, WorkspaceScopePayload } from '@/core/types';
import { fetchCliApps, fetchMcpPresets, listSlashCommands } from '@/core/api';
import { getNanobotStatus, getNanobotToken, refreshNanobotAuth } from '@/core/nanobotClient';
import {
  CLI_APPS_CHANGED_EVENT,
  installedCliAppsFromPayload,
  isCliAppsPayload,
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
import { visibleProjectPath } from '@/core/workspace';

export interface ChatInputSendOptions {
  cliApps?: OutboundCliAppMention[];
  mcpPresets?: OutboundMcpPresetMention[];
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
  labelKey: 'shortcutWrite' | 'shortcutLearn' | 'shortcutCode' | 'shortcutLife' | 'shortcutRuyi';
  options: ShortcutOption[];
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    id: 'write',
    icon: Pencil,
    labelKey: 'shortcutWrite',
    options: [
      {
        key: 'improve_style',
        labelZh: '改进写作风格',
        labelEn: 'Improve writing style',
        promptZh: '嗨，如意！你能帮我改进一下写作风格吗？如果你需要我提供更多信息，请立即问我一两个关键问题。如果你觉得我应该提供更多背景信息或上传任何资料来帮助你更好地完成工作，也请告诉我。如果对你有帮助，可以使用任何你能访问的工具，比如网络搜索等等。',
        promptEn: 'Hi Ruyi! Can you help me improve my writing style? If you need more information, please ask one or two key questions right away. If you think I should provide more context or upload any files to help you do a better job, please let me know. If it helps, you can use any tools you have access to, such as web search.',
      },
      {
        key: 'write_speech',
        labelZh: '写演讲稿',
        labelEn: 'Write speech script',
        promptZh: '嗨，如意！你能帮我写一下演讲稿吗？如果你需要我提供更多信息，请立即问我一两个关键问题。如果你觉得我应该提供更多背景信息或者上传一些资料来帮助你更好地完成演讲，也请告诉我。你可以使用任何你能访问的工具，比如网络搜索等等，只要它们对你有帮助。',
        promptEn: 'Hi Ruyi! Can you help me write a speech? If you need more information, please ask one or two key questions right away. If you think I should provide more context or upload some files to help you do a better job, please let me know. You can use any tools you have access to, such as web search, as long as they help.',
      },
      {
        key: 'project_proposal',
        labelZh: '撰写项目申请书',
        labelEn: 'Draft project proposal',
        promptZh: '嗨，如意！你能帮我写项目申请书吗？如果你需要我提供更多信息，请立即问我一两个关键问题。如果你觉得我应该提供更多背景信息或上传任何资料来帮助你更好地完成申请，请告诉我。如果对你有帮助，你可以使用任何你能访问的工具，比如网络搜索等等。',
        promptEn: 'Hi Ruyi! Can you help me write a project proposal? If you need more information, please ask one or two key questions right away. If you think I should provide more context or upload any files to help you do a better job, please let me know. If it helps, you can use any tools you have access to, such as web search.',
      },
    ],
  },
  {
    id: 'learn',
    icon: GraduationCap,
    labelKey: 'shortcutLearn',
    options: [
      {
        key: 'study_schedule',
        labelZh: '规划学习时间表',
        labelEn: 'Plan study schedule',
        promptZh: '嗨，如意！你能帮我制作学习时间表吗？如果你需要我提供更多信息，请立即问我一两个关键问题。如果你觉得我应该提供更多背景信息或上传任何资料来帮助你更好地完成工作，请告诉我。你可以使用任何你能访问的工具，例如网络搜索等等，只要它们对你有帮助。',
        promptEn: 'Hi Ruyi! Can you help me create a study schedule? If you need more information from me, please ask one or two key questions right away. If you think I should provide more context or upload any files to help you do a better job, please let me know. You can use any tools you have access to, such as web search, as long as they help.',
      },
    ],
  },
  {
    id: 'code',
    icon: Code,
    labelKey: 'shortcutCode',
    options: [
      {
        key: 'write_code',
        labelZh: '编写算法/代码',
        labelEn: 'Write code / algorithm',
        promptZh: '嗨，如意！你能帮我编写一段代码吗？如果你需要我提供更多信息，请立即问我一两个关键问题。如果你觉得我应该提供更多背景信息或上传任何资料来帮助你更好地完成，请告诉我。如果对你有帮助，可以使用任何你能访问的工具，比如网络搜索等等。',
        promptEn: 'Hi Ruyi! Can you help me write some code? If you need more information, please ask one or two key questions right away. If you think I should provide more context or upload any files, please let me know. If it helps, you can use any tools you have access to, such as web search.',
      },
      {
        key: 'refactor_code',
        labelZh: '解释/重构代码',
        labelEn: 'Explain or refactor code',
        promptZh: '嗨，如意！你能帮我解释或重构一段代码吗？如果你需要我提供更多信息，请立即问我一两个关键问题。如果你觉得我应该提供更多背景信息或上传任何资料来帮助你，请告诉我。可以使用任何你能访问的工具，比如网络搜索等等。',
        promptEn: 'Hi Ruyi! Can you help me explain or refactor some code? If you need more information, please ask one or two key questions right away. If you think I should provide more context or upload any files, please let me know. If it helps, you can use any tools you have access to, such as web search.',
      },
      {
        key: 'debug_code',
        labelZh: '排查 Bug',
        labelEn: 'Debug and fix bugs',
        promptZh: '嗨，如意！你能帮我排查代码中的 Bug 吗？如果你需要我提供更多信息，请立即问我一两个关键问题。如果你觉得我应该提供更多背景信息或上传任何资料来帮助你更好地完成，请告诉我。如果对你有帮助，可以使用网络搜索等工具。',
        promptEn: 'Hi Ruyi! Can you help me find and fix a bug in my code? If you need more information, please ask one or two key questions right away. If you think I should provide more context or upload any files, please let me know. If it helps, you can use any tools you have access to, such as web search.',
      },
    ],
  },
  {
    id: 'life',
    icon: Coffee,
    labelKey: 'shortcutLife',
    options: [
      {
        key: 'improve_habits',
        labelZh: '改进习惯',
        labelEn: 'Improve habits',
        promptZh: '嗨，如意！你能帮我改进一下习惯吗？如果你需要我提供更多信息，请立即问我一两个关键问题。如果你觉得我应该提供更多背景信息或上传任何资料来帮助你更好地完成工作，请告诉我。如果有什么工具能帮到你，比如网络搜索等等，都可以用。',
        promptEn: 'Hi Ruyi! Can you help me improve my habits? If you need more information, please ask one or two key questions right away. If you think I should provide more context or upload any files to help you do a better job, please let me know. If any tools can help, such as web search, feel free to use them.',
      },
    ],
  },
  {
    id: 'ruyi',
    icon: Lightbulb,
    labelKey: 'shortcutRuyi',
    options: [
      {
        key: 'casual_chat',
        labelZh: '日常闲聊/咨询',
        labelEn: 'Casual chat / consultation',
        promptZh: '嗨，如意！我想找你随便聊聊，或者问你一些问题。如果你需要我提供更多背景信息，请告诉我。',
        promptEn: 'Hi Ruyi! I want to have a casual chat with you or ask you some questions. If you need more context, please let me know.',
      },
      {
        key: 'brainstorming',
        labelZh: '如意推荐的创意启发',
        labelEn: 'Creative brainstorming',
        promptZh: '嗨，如意！你能帮我提供一些有创意的想法或灵感吗？如果你需要我提供更多背景，请告诉我。如果有什么工具能帮到你，都可以使用。',
        promptEn: 'Hi Ruyi! Can you help me brainstorm some creative ideas or inspiration? If you need more context, please let me know. Feel free to use any tools, such as web search.',
      },
    ],
  },
];

interface ChatInputProps {
  variant: 'welcome' | 'chat';
  onSend: (message: string, images?: ImageAttachment[], workspacePath?: string | null, options?: ChatInputSendOptions) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  workspaceScope?: WorkspaceScopePayload | null;
  onWorkspaceScopeChange?: (scope: WorkspaceScopePayload | null) => void;
}

interface SuggestionItem {
  name: string;
  description: string;
  detail?: string;
  kind: 'slash' | 'cli' | 'mcp';
  slashCommand?: SlashCommand;
  cliApp?: CliAppInfo;
  mcpPreset?: McpPresetInfo;
}

interface FileAttachmentItem {
  id: string;
  path: string;
  name: string;
}

interface ComposerDraft {
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
          && typeof file.name === 'string',
        )
      : [],
    skills: Array.isArray(record.skills) ? record.skills.filter((skill): skill is string => typeof skill === 'string') : [],
    cliApps: Array.isArray(record.cliApps) ? record.cliApps : [],
    mcpPresets: Array.isArray(record.mcpPresets) ? record.mcpPresets : [],
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

export default function ChatInput({ variant, onSend, onStop, isStreaming: isStreamingProp, disabled, workspaceScope, onWorkspaceScopeChange }: ChatInputProps) {
  const isWelcome = variant === 'welcome';

  const [text, setText] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [files, setFiles] = useState<FileAttachmentItem[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedCliApps, setSelectedCliApps] = useState<OutboundCliAppMention[]>([]);
  const [selectedMcpPresets, setSelectedMcpPresets] = useState<OutboundMcpPresetMention[]>([]);
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [cliApps, setCliApps] = useState<CliAppInfo[]>([]);
  const [mcpPresets, setMcpPresets] = useState<McpPresetInfo[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<'project' | 'skills' | 'connector' | null>(null);
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [connectorSearchQuery, setConnectorSearchQuery] = useState('');
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const skills = useDiscoveryStore((s) => s.skills);
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
  const pendingInput = useChatStore((s) => s.pendingInput);
  const setPendingInput = useChatStore((s) => s.setPendingInput);
  const activeConv = useActiveConversation();
  const draftKey = useMemo(() => draftStorageKey(activeConv?.id, variant), [activeConv?.id, variant]);
  const queueKey = useMemo(() => queueStorageKey(activeConv?.id, variant), [activeConv?.id, variant]);
  const currentModel = useSettingsStore((s) => getEffectiveModel(s));
  const provider = useSettingsStore((s) => s.provider);
  const setModel = useSettingsStore((s) => s.setModel);
  const recentPaths = useWorkspaceStore((s) => s.recentPaths);
  const conversations = useChatStore((s) => s.conversations);
  const grantPermission = usePermissionStore((s) => s.grantPermission);
  const hasPermission = usePermissionStore((s) => s.hasPermission);
  const { t } = useI18n();
  const language = useSettingsStore((s) => s.language);
  const isEn = language === 'en-US';

  // Chat-only derived state
  const isRunning = activeConv?.status === 'running';
  const isStreaming = isStreamingProp ?? (!isWelcome && isRunning);
  const availableModels = AVAILABLE_MODELS[provider] ?? [];
  const modelDisplay = availableModels.find((m) => m.id === currentModel)?.label
    ?? (currentModel ? currentModel.split('/').pop()?.split('-').slice(0, 2).join(' ') : 'Claude');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);

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
    isSubmittingRef.current = true;
    writeDraft(draftKey, { text: '', images: [], files: [], skills: [], cliApps: [], mcpPresets: [] });
    submitDraft(draft);
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
    if (consumedPendingInputRef.current) {
      consumedPendingInputRef.current = false;
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
    window.setTimeout(() => {
      skipDraftPersistRef.current = false;
    }, 0);
  }, [draftKey]);

  useEffect(() => {
    if (skipDraftPersistRef.current) return;
    if (isSubmittingRef.current) {
      const hasPayload = text.trim() || images.length || files.length || selectedSkills.length || selectedCliApps.length || selectedMcpPresets.length;
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
    });
  }, [draftKey, files, images, selectedCliApps, selectedMcpPresets, selectedSkills, text]);

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
  const { isDragging } = useFileDragDrop(async (paths) => {
    await processFilePaths(
      paths,
      (imgs) => setImages((prev) => [...prev, ...imgs].slice(0, MAX_IMAGES_PER_MESSAGE)),
      (items) => setFiles((prev) => [...prev, ...items]),
    );
    textareaRef.current?.focus();
  });

  // Welcome-only: folder & permission handlers
  const handleSelectFolder = (folderPath: string) => {
    if (onWorkspaceScopeChange) {
      const parts = folderPath.split('/').filter(Boolean);
      const base = workspaceScope ?? { access_mode: 'full' as const, restrict_to_workspace: false };
      onWorkspaceScopeChange({
        ...base,
        project_path: folderPath,
        project_name: parts[parts.length - 1] || folderPath,
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

        const [commands, cliPayload, mcpPayload] = await Promise.all([
          listSlashCommands(token, base),
          fetchCliApps(token, base),
          fetchMcpPresets(token, base),
        ]);
        if (cancelled) return;
        setSlashCommands(commands);
        setCliApps(installedCliAppsFromPayload(cliPayload).filter((app) => app.available));
        setMcpPresets(installedMcpPresetsFromPayload(mcpPayload).filter((preset) => preset.available));
      } catch {
        if (!cancelled) {
          setSlashCommands([]);
          setCliApps([]);
          setMcpPresets([]);
        }
      }
    };
    loadCapabilities();

    const refreshOnFocus = () => {
      if (document.visibilityState === 'hidden') return;
      void loadCapabilities();
    };
    const refreshOnCliAppsChanged = (event: Event) => {
      const payload = (event as CustomEvent<unknown>).detail;
      if (isCliAppsPayload(payload)) {
        setCliApps(installedCliAppsFromPayload(payload).filter((app) => app.available));
        return;
      }
      void loadCapabilities();
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
    window.addEventListener(CLI_APPS_CHANGED_EVENT, refreshOnCliAppsChanged);
    window.addEventListener(MCP_PRESETS_CHANGED_EVENT, refreshOnMcpPresetsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
      window.removeEventListener(CLI_APPS_CHANGED_EVENT, refreshOnCliAppsChanged);
      window.removeEventListener(MCP_PRESETS_CHANGED_EVENT, refreshOnMcpPresetsChanged);
    };
  }, []);

  // Suggestion popup is hidden for business users; use the + menu instead.
  const suggestionType = useMemo((): 'slash' | 'mention' | null => {
    return null;
  }, []);

  // Slash command and capability suggestions.
  const suggestions = useMemo((): SuggestionItem[] => {
    const trimmed = text.trim();

    // Capability suggestions when typing @
    if (suggestionType === 'mention') {
      const query = trimmed.slice(1).toLowerCase();
      const cliItems: SuggestionItem[] = cliApps
        .filter((app) => {
          if (selectedCliApps.some((selected) => selected.name === app.name)) return false;
          if (!query) return true;
          return app.name.toLowerCase().includes(query)
            || app.display_name.toLowerCase().includes(query)
            || app.description.toLowerCase().includes(query);
        })
        .map((app) => ({
          name: app.name,
          description: app.description || app.display_name,
          detail: app.display_name,
          kind: 'cli' as const,
          cliApp: app,
        }));
      const mcpItems: SuggestionItem[] = mcpPresets
        .filter((preset) => {
          if (selectedMcpPresets.some((selected) => selected.name === preset.name)) return false;
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
      return [...cliItems, ...mcpItems];
    }

    // Nanobot slash commands when typing /
    if (suggestionType === 'slash') {
      const query = trimmed.slice(1).toLowerCase();
      return slashCommands
        .filter((command) => command.command !== '/stop' || isStreaming)
        .filter((command) => {
          if (!query) return true;
          return command.command.toLowerCase().includes(query)
            || command.title.toLowerCase().includes(query)
            || command.description.toLowerCase().includes(query);
        })
        .map((command) => ({
          name: command.command,
          description: command.description || command.title,
          detail: command.argHint,
          kind: 'slash' as const,
          slashCommand: command,
        }));
    }
    return [];
  }, [text, suggestionType, cliApps, mcpPresets, slashCommands, selectedCliApps, selectedMcpPresets, isStreaming]);

  // Reset dismissed state when suggestions change
  useEffect(() => {
    setSuggestionsDismissed(false);
    if (suggestionType !== null && suggestions.length > 0) setSelectedIndex(0);
  }, [suggestionType, suggestions.length]);

  // Derived: show suggestions when there are matches and not dismissed
  const showSuggestions = !suggestionsDismissed && suggestionType !== null && suggestions.length > 0;

  // Auto-resize textarea
  const maxHeight = isWelcome ? 180 : 160;
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
    }
  }, [text, maxHeight]);

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
    setText('');
    setImages([]);
    setFiles([]);
    setSelectedSkills([]);
    setSelectedCliApps([]);
    setSelectedMcpPresets([]);
    setSuggestionsDismissed(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const submitDraft = (draft: ComposerDraft, workspacePath?: string | null) => {
    const trimmed = draft.text?.trim() ?? '';
    // Build file context prefix
    const fileContext = draft.files?.length
      ? [
          '本地文件引用（请按路径读取这些文件；如果路径超出当前工作区权限，请先说明无法访问）：',
          ...draft.files.map((f) => `- ${f.name}: ${f.path}`),
        ].join('\n')
      : '';

    const capabilityMentions = [
      ...(draft.cliApps?.map((app) => `@${app.name}`) ?? []),
      ...(draft.mcpPresets?.map((preset) => `@${preset.name}`) ?? []),
    ].join(' ');

    const skillPrefix = draft.skills?.length
      ? draft.skills.map((skill) => `/${skill}`).join(' ')
      : '';

    // Compose parts, then join with newline
    const bodyParts = [fileContext, capabilityMentions, skillPrefix, trimmed].filter(Boolean).join('\n');

    const message = bodyParts;

    onSend(
      message,
      draft.images?.length ? draft.images : undefined,
      isWelcome ? workspacePath ?? localWorkspace : undefined,
      {
        ...(draft.cliApps?.length ? { cliApps: draft.cliApps } : {}),
        ...(draft.mcpPresets?.length ? { mcpPresets: draft.mcpPresets } : {}),
      },
    );
  };

  const currentDraft = (): ComposerDraft => ({
    text,
    images,
    files,
    skills: selectedSkills,
    cliApps: selectedCliApps,
    mcpPresets: selectedMcpPresets,
  });

  const handleSend = () => {
    const draft = currentDraft();
    if (!hasDraftPayload(draft) || disabled) return;
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

    isSubmittingRef.current = true;
    writeDraft(draftKey, { text: '', images: [], files: [], skills: [], cliApps: [], mcpPresets: [] });
    submitDraft(draft);
    resetInput();
  };

  const sendQueuedPrompt = useCallback((prompt: QueuedPrompt) => {
    setQueuedPrompts((items) => items.filter((item) => item.id !== prompt.id));
    submitDraft(prompt);
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
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
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

  const renderPlusMenu = () => {
    const filteredSkills = skills.filter((skill) => {
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
            <span>{isEn ? 'Add files or photos' : '添加文件或图片'}</span>
          </div>
          <span className="text-[#8a867c] text-[11px] font-sans">⌘U</span>
        </button>


        {/* Skills */}
        <div
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
              "absolute left-full top-0 w-64 bg-white rounded-2xl border border-[#dedbd3] shadow-lg py-1.5 z-50 animate-in fade-in slide-in-from-left-1 duration-150"
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
              {skills.length === 0 ? (
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
                          setShowPlusMenu(false);
                          setActiveSubmenu(null);
                          setSkillSearchQuery('');
                          textareaRef.current?.focus();
                        }}
                        className="w-full flex items-center justify-between gap-2 px-3.5 py-2 hover:bg-[#f5f3ee] transition-colors text-left cursor-pointer"
                      >
                        <div className="min-w-0 flex flex-col">
                          <span className="font-medium text-[#29261b] truncate">/{skill.name}</span>
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
              "absolute left-full top-0 w-64 bg-white rounded-2xl border border-[#dedbd3] shadow-lg py-1.5 z-50 animate-in fade-in slide-in-from-left-1 duration-150"
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
                    const isSelected = selectedMcpPresets.some((s) => s.name === preset.name);
                    return (
                      <button
                        key={preset.name}
                        onClick={() => {
                          if (isSelected) {
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
                        className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-[#f5f3ee] transition-colors text-left cursor-pointer"
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
        setSkillSearchQuery('');
        setConnectorSearchQuery('');
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showPlusMenu]);

  const hasAttachments = images.length > 0 || files.length > 0;
  const hasContent = text.trim().length > 0 || selectedSkills.length > 0 || selectedCliApps.length > 0 || selectedMcpPresets.length > 0 || hasAttachments;
  const showProjectSelector = !activeConv?.workspacePath && !activeConv?.workspaceScope?.project_path;
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
    Object.values(conversations)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach((conv) => add(conv.workspaceScope?.project_path ?? conv.workspacePath));
    return paths;
  }, [conversations, recentPaths]);

  // Determine placeholder based on selected command
  const placeholder = hoverPrompt
    ? hoverPrompt
    : disabled
      ? t.chat.inputPlaceholderBusy
      : isRunning
        ? t.chat.inputPlaceholderMidTask
        : t.chat.inputPlaceholder;

  return (
    <>
      {/* Welcome-only: Permission Dialog */}
      {isWelcome && pendingFolder && (
        <PermissionDialog
          request={{ type: 'workspace', path: pendingFolder }}
          onAllow={handleAllowPermission}
          onDeny={handleDenyPermission}
        />
      )}

      <div className="relative">
        {queuedPrompts.length > 0 && (
          <div className="mb-2 rounded-2xl border border-[#dedbd3] bg-white/90 p-1.5 shadow-sm">
            <div className="max-h-48 overflow-y-auto">
              {queuedPrompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className="group flex min-h-8 items-center gap-1.5 rounded-xl px-2 py-1 text-[13px] transition-colors hover:bg-[#f5f3ee]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 whitespace-pre-wrap break-words font-medium leading-snug text-[#29261b]">
                      {queuedPromptLabel(prompt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => sendQueuedPrompt(prompt)}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium text-[#656358] transition-colors hover:bg-[#e8e5de] hover:text-[#29261b]"
                    title="立即发送"
                  >
                    <CornerDownRight className="h-3 w-3" />
                    发送
                  </button>
                  <button
                    type="button"
                    onClick={() => editQueuedPrompt(prompt)}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#656358] transition-colors hover:bg-[#e8e5de] hover:text-[#29261b]"
                    title="编辑"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteQueuedPrompt(prompt.id)}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#656358] transition-colors hover:bg-[#e8e5de] hover:text-red-600"
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
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-2xl border border-[#dedbd3] shadow-lg overflow-hidden z-20">
            {suggestions.map((item, idx) => (
              <button
                key={`${item.kind ?? suggestionType}-${item.name}`}
                onClick={() => applySuggestion(item)}
                className={cn(
                  'btn-ghost w-full flex flex-col gap-0.5 px-4 py-2.5 text-sm text-left',
                  idx === selectedIndex ? 'bg-[#e8e5de]' : 'hover:bg-[#f5f3ee]'
                )}
              >
                <div className="flex items-center gap-3">
                  <span className={cn(
                    'w-5 text-center font-mono text-[12px] shrink-0',
                    suggestionType === 'mention' ? 'text-[#656358]' : 'text-[#656358]'
                  )}>
                    {suggestionType === 'mention' ? '@' : '/'}
                  </span>
                  <span className="font-medium text-[#29261b] text-[13px]">{item.name}</span>
                  {item.kind === 'slash' && (
                    <span className="rounded bg-[#f3f2ee] px-1.5 py-0.5 text-[10px] font-medium text-[#656358]">Command</span>
                  )}
                  {item.kind === 'cli' && (
                    <span className="rounded bg-[#eef2ff] px-1.5 py-0.5 text-[10px] font-medium text-[#4f46e5]">CLI</span>
                  )}
                  {item.kind === 'mcp' && (
                    <span className="rounded bg-[#ecfdf5] px-1.5 py-0.5 text-[10px] font-medium text-[#047857]">MCP</span>
                  )}
                  <span className="text-[12px] text-[#656358] truncate">{item.description}</span>
                </div>
                {item.detail && (
                  <div className="pl-8 text-[11px] text-[#656358]/70 truncate">
                    {item.detail}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Unified Input Widget Container */}
        <div className="relative rounded-[24px] bg-[#faf9f6] border border-[#e8e4dd] shadow-[0_6px_24px_rgba(0,0,0,0.06)] flex flex-col">
          {/* Input Card */}
          <div
            className={cn(
              'relative bg-white border border-[#e8e5de]/60 rounded-[24px] shadow-[0_4px_12px_rgba(0,0,0,0.03)] transition-all',
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

          {/* Textarea Row with inline command prefix */}
          <div className={cn(
            'flex items-start gap-0',
            isWelcome
              ? hasAttachments ? 'px-5 pt-1 pb-1' : 'px-5 pt-5 pb-1'
              : hasAttachments ? 'px-4 pt-1 pb-1' : 'px-4 pt-3.5 pb-1'
          )}>
            {/* Inline command prefix (unified for both variants) */}
            {selectedSkills.map((skill) => (
              <button
                key={`selected-skill-${skill}`}
                onClick={() => setSelectedSkills((prev) => prev.filter((item) => item !== skill))}
                className="shrink-0 mt-[3px] mr-1.5 rounded-full bg-[#f3f2ee] px-2 py-0.5 text-[12px] font-medium text-[#656358] hover:line-through"
                title={t.common.close}
              >
                /{skill}
              </button>
            ))}
            {selectedCliApps.map((app) => (
              <button
                key={`selected-cli-${app.name}`}
                onClick={() => setSelectedCliApps((prev) => prev.filter((item) => item.name !== app.name))}
                className="shrink-0 mt-[3px] mr-1.5 rounded-full bg-[#eef2ff] px-2 py-0.5 text-[12px] font-medium text-[#4f46e5] hover:line-through"
                title={t.common.close}
              >
                @{app.display_name || app.name}
              </button>
            ))}
            {selectedMcpPresets.map((preset) => (
              <button
                key={`selected-mcp-${preset.name}`}
                onClick={() => setSelectedMcpPresets((prev) => prev.filter((item) => item.name !== preset.name))}
                className="shrink-0 mt-[3px] mr-1.5 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[12px] font-medium text-[#047857] hover:line-through"
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
              rows={isWelcome ? 2 : 1}
              className={cn(
                'flex-1 bg-transparent resize-none outline-none text-[#29261b] leading-relaxed placeholder:text-[#8f8b82] font-user-message',
                isWelcome
                  ? 'min-h-[64px] max-h-[180px] text-[18px]'
                  : 'min-h-[28px] max-h-[160px] py-0.5 text-[15px] disabled:opacity-40'
              )}
            />
          </div>

          {/* Bottom Toolbar */}
          {isWelcome ? (
            /* Welcome variant: [+] + --- + Start button */
            <div className="flex items-center gap-2 px-5 pb-4">
              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowPlusMenu(!showPlusMenu)}
                  aria-label={t.chat.addAttachment}
                  className={cn(
                    "btn-ghost h-8 w-8 text-[#29261b] hover:text-[#29261b] rounded-xl transition-colors",
                    showPlusMenu ? "bg-[#eeeeea]" : "hover:bg-[#eeeeea]"
                  )}
                >
                  <Plus className={cn("h-4 w-4 transition-transform duration-200", showPlusMenu && "rotate-45")} />
                </Button>
                {showPlusMenu && renderPlusMenu()}
              </div>
              <div className="flex-1" />

              <button
                onClick={handleSend}
                disabled={!hasContent}
                className={cn(
                  'btn-claude-primary flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium',
                  hasContent
                    ? 'bg-[#29261b] text-[#faf9f5] shadow-sm'
                    : 'bg-[#e8e5de] text-[#656358]/50 cursor-not-allowed'
                )}
              >
                <span>{t.chat.start}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            /* Chat variant: [+] + --- + Model label + Stop/Send */
            <div className="flex items-center justify-between px-4 pb-3 pt-1">
              {/* Left Actions */}
              <div className="flex items-center gap-0.5">
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowPlusMenu(!showPlusMenu)}
                    aria-label={t.chat.addAttachment}
                    className={cn(
                      "btn-ghost h-8 w-8 text-[#29261b] hover:text-[#29261b] rounded-xl transition-colors",
                      showPlusMenu ? "bg-[#eeeeea]" : "hover:bg-[#eeeeea]"
                    )}
                  >
                    <Plus className={cn("h-4 w-4 transition-transform duration-200", showPlusMenu && "rotate-45")} />
                  </Button>
                  {showPlusMenu && renderPlusMenu()}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Model picker dropdown */}
                <div className="relative" ref={modelPickerRef}>
                  <button
                    onClick={() => setShowModelPicker(!showModelPicker)}
                    className="btn-ghost flex items-center gap-1 px-2.5 py-1.5 text-[14px] text-[#3d3929] font-medium hover:text-[#29261b] hover:bg-[#eeeeea] rounded-lg transition-colors"
                  >
                    {modelDisplay}
                    <ChevronDown className={cn('h-3 w-3 transition-transform', showModelPicker && 'rotate-180')} />
                  </button>
                  {showModelPicker && availableModels.length > 0 && (
                    <div className="absolute bottom-full right-0 mb-1.5 w-56 bg-white rounded-xl border border-[#dedbd3] shadow-lg py-1 z-50">
                      {availableModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            setModel(m.id);
                            setShowModelPicker(false);
                          }}
                          className={cn(
                            'w-full flex items-center justify-between px-3 py-1.5 text-[12px] transition-colors text-left',
                            m.id === currentModel
                              ? 'text-[#d97757] font-medium bg-[#d97757]/5'
                              : 'text-[#29261b] hover:bg-[#f5f3ee]'
                          )}
                        >
                          <span>{m.label}</span>
                          {m.id === currentModel && <Check className="h-3.5 w-3.5 text-[#d97757]" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Send / Stop Button */}
                {isStreaming ? (
                  <>
                    <Button
                      size="icon"
                      onClick={handleSend}
                      disabled={!hasContent || disabled}
                      aria-label="加入队列"
                      className={cn(
                        'h-8 w-8 rounded-xl transition-colors',
                        hasContent && !disabled
                          ? 'bg-[#29261b] hover:bg-[#3d3a2f] text-[#faf9f5] shadow-sm'
                          : 'bg-[#e8e5de] text-[#656358]/50 cursor-not-allowed hover:bg-[#e8e5de]',
                      )}
                      title="加入队列"
                    >
                      <CornerDownRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      onClick={handleStop}
                      aria-label={t.chat.stop}
                      className="btn-claude-primary h-8 w-8 rounded-xl bg-red-500 hover:bg-red-600 text-white shadow-sm"
                      title={t.chat.stop}
                    >
                      <Square className="h-3 w-3" fill="currentColor" />
                    </Button>
                  </>
                ) : (
                  <Button
                    size="icon"
                    onClick={handleSend}
                    disabled={!hasContent || disabled}
                    className={cn(
                      'h-8 w-8 rounded-xl transition-colors',
                      hasContent && !disabled
                        ? 'bg-[#29261b] hover:bg-[#3d3a2f] text-[#faf9f5] shadow-sm'
                        : 'bg-[#e8e5de] text-[#656358]/50 cursor-not-allowed hover:bg-[#e8e5de]'
                    )}
                  >
                    <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {showProjectSelector && (
          <div className="flex items-center gap-4 px-5 py-1 text-[#656358] text-[12.5px] select-none z-10 rounded-b-[24px]">
            <FolderSelector
              variant="pill"
              currentPath={workspaceScope?.project_path ?? localWorkspace}
              recentPaths={projectSelectorPaths}
              onSelect={handleSelectFolder}
              onClear={handleClearWorkspace}
            />
          </div>
        )}
      </div>



        {isWelcome && activeCategory && (
          <div
            ref={categoryPanelRef}
            className="absolute bottom-full left-0 right-0 mb-2.5 bg-[#fffefa] rounded-[24px] border border-[#dedbd3] shadow-lg overflow-hidden z-30 animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            {/* Header */}
            {(() => {
              const category = SHORTCUT_CATEGORIES.find((c) => c.id === activeCategory);
              if (!category) return null;
              const Icon = category.icon;
              return (
                <div className="flex items-center justify-between px-5 pt-4 pb-3 text-[#656358] text-[13px] font-medium border-b border-[#f0ede6]">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-[#656358]" />
                    <span>{t.chat[category.labelKey]}</span>
                  </div>
                  <button
                    onClick={() => setActiveCategory(null)}
                    className="p-1 hover:bg-[#f5f3ee] rounded-lg transition-colors text-[#656358] hover:text-[#29261b]"
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
                      "w-full text-left py-3.5 px-5 hover:bg-[#f5f3ee] text-[14px] text-[#29261b] transition-colors flex items-center justify-between group",
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
          <div className="flex flex-wrap items-center justify-center gap-2.5 mt-4">
            <button
              onClick={() => handleShortcut('write')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#dedbd3] bg-white hover:bg-[#f5f3ee] text-[#29261b] text-[13px] font-medium shadow-sm transition-colors"
            >
              <Pencil className="h-3.5 w-3.5 text-[#656358]" />
              <span>{t.chat.shortcutWrite}</span>
            </button>
            <button
              onClick={() => handleShortcut('learn')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#dedbd3] bg-white hover:bg-[#f5f3ee] text-[#29261b] text-[13px] font-medium shadow-sm transition-colors"
            >
              <GraduationCap className="h-3.5 w-3.5 text-[#656358]" />
              <span>{t.chat.shortcutLearn}</span>
            </button>
            <button
              onClick={() => handleShortcut('code')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#dedbd3] bg-white hover:bg-[#f5f3ee] text-[#29261b] text-[13px] font-medium shadow-sm transition-colors"
            >
              <Code className="h-3.5 w-3.5 text-[#656358]" />
              <span>{t.chat.shortcutCode}</span>
            </button>
            <button
              onClick={() => handleShortcut('life')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#dedbd3] bg-white hover:bg-[#f5f3ee] text-[#29261b] text-[13px] font-medium shadow-sm transition-colors"
            >
              <Coffee className="h-3.5 w-3.5 text-[#656358]" />
              <span>{t.chat.shortcutLife}</span>
            </button>
            <button
              onClick={() => handleShortcut('ruyi')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#dedbd3] bg-white hover:bg-[#f5f3ee] text-[#29261b] text-[13px] font-medium shadow-sm transition-colors"
            >
              <Lightbulb className="h-3.5 w-3.5 text-[#656358]" />
              <span>{t.chat.shortcutRuyi}</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
