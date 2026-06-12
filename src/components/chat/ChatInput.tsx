import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Plus, ArrowUp, ArrowRight, Square, X, ChevronDown, Check, FileText } from 'lucide-react';
import { dialogBridge, fsBridge } from '@/lib/ipc-factory';
import { useFileDragDrop } from '@/hooks/useFileDragDrop';
import { uint8ArrayToBase64 } from '@/utils/base64';
import { getBaseName, IMAGE_MIME_MAP } from '@/utils/pathUtils';
import { isImageFile } from '@/components/chat/FileAttachment';
import { useChatStore, useActiveConversation } from '@/stores/chatStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useSettingsStore, getEffectiveModel, AVAILABLE_MODELS } from '@/stores/settingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { usePermissionStore } from '@/stores/permissionStore';
import type { PermissionDuration } from '@/stores/permissionStore';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ImageAttachment } from '@/types';
import type { OutboundCliAppMention, OutboundMcpPresetMention } from '@/core/types';
import type { CliAppInfo, McpPresetInfo } from '@/core/types';
import { fetchCliApps, fetchMcpPresets } from '@/core/api';
import { getNanobotStatus, getNanobotToken, refreshNanobotAuth } from '@/core/nanobotClient';
import { generateAttachmentId, readFileAsBase64, SUPPORTED_IMAGE_TYPES } from '@/utils/imageUtils';
import PermissionDialog from '@/components/common/PermissionDialog';
import FolderSelector from '@/components/common/FolderSelector';

export interface ChatInputSendOptions {
  cliApps?: OutboundCliAppMention[];
  mcpPresets?: OutboundMcpPresetMention[];
}

interface ChatInputProps {
  variant: 'welcome' | 'chat';
  onSend: (message: string, images?: ImageAttachment[], workspacePath?: string | null, options?: ChatInputSendOptions) => void;
  disabled?: boolean;
}

interface SuggestionItem {
  name: string;
  description: string;
  trigger?: string;
  kind?: 'agent' | 'skill' | 'cli' | 'mcp';
  cliApp?: CliAppInfo;
  mcpPreset?: McpPresetInfo;
}

interface FileAttachmentItem {
  id: string;
  path: string;
  name: string;
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
    const results = await Promise.allSettled(imgPaths.map(readLocalImage));
    const newImages: ImageAttachment[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        newImages.push(r.value);
      } else {
        filePaths.push(imgPaths[i]);
      }
    });
    if (newImages.length > 0) addImages(newImages);
  }
  if (filePaths.length > 0) {
    addFiles(filePaths.map((p) => ({ id: generateAttachmentId(), path: p, name: getBaseName(p) })));
  }
}

export default function ChatInput({ variant, onSend, disabled }: ChatInputProps) {
  const isWelcome = variant === 'welcome';

  const [text, setText] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [files, setFiles] = useState<FileAttachmentItem[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SuggestionItem | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<SuggestionItem | null>(null);
  const [selectedCliApps, setSelectedCliApps] = useState<OutboundCliAppMention[]>([]);
  const [selectedMcpPresets, setSelectedMcpPresets] = useState<OutboundMcpPresetMention[]>([]);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [cliApps, setCliApps] = useState<CliAppInfo[]>([]);
  const [mcpPresets, setMcpPresets] = useState<McpPresetInfo[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Welcome-only state (always declared for hook stability)
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  const [localWorkspace, setLocalWorkspace] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const lastCompositionEndTimeRef = useRef<number>(0);

  // Store hooks (always called)
  const cancelStreaming = useChatStore((s) => s.cancelStreaming);
  const pendingInput = useChatStore((s) => s.pendingInput);
  const setPendingInput = useChatStore((s) => s.setPendingInput);
  const activeConv = useActiveConversation();
  const skills = useDiscoveryStore((s) => s.skills);
  const agents = useDiscoveryStore((s) => s.agents);
  const currentModel = useSettingsStore((s) => getEffectiveModel(s));
  const provider = useSettingsStore((s) => s.provider);
  const setModel = useSettingsStore((s) => s.setModel);
  const recentPaths = useWorkspaceStore((s) => s.recentPaths);
  const grantPermission = usePermissionStore((s) => s.grantPermission);
  const hasPermission = usePermissionStore((s) => s.hasPermission);
  const { t } = useI18n();

  // Chat-only derived state
  const isRunning = activeConv?.status === 'running';
  const isStreaming = !isWelcome && isRunning;
  const availableModels = AVAILABLE_MODELS[provider] ?? [];
  const modelDisplay = availableModels.find((m) => m.id === currentModel)?.label
    ?? (currentModel ? currentModel.split('/').pop()?.split('-').slice(0, 2).join(' ') : 'Claude');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);

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

    for (const item of Array.from(items)) {
      if (SUPPORTED_IMAGE_TYPES.includes(item.type)) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const { data, mediaType } = await readFileAsBase64(file);
        setImages((prev) => [...prev, { id: generateAttachmentId(), data, mediaType }]);
      }
    }
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // Consume pending input
  useEffect(() => {
    if (pendingInput) {
      setText(pendingInput);
      setPendingInput(null);
      textareaRef.current?.focus();
    }
  }, [pendingInput, setPendingInput]);

  const handleStop = () => {
    if (activeConv?.id) {
      cancelStreaming(activeConv.id);
    }
  };

  // File drag & drop (always called; works for both variants)
  const { isDragging } = useFileDragDrop(async (paths) => {
    await processFilePaths(
      paths,
      (imgs) => setImages((prev) => [...prev, ...imgs]),
      (items) => setFiles((prev) => [...prev, ...items]),
    );
    textareaRef.current?.focus();
  });

  // Welcome-only: folder & permission handlers
  const handleSelectFolder = (folderPath: string) => {
    if (hasPermission(folderPath, 'read')) {
      setLocalWorkspace(folderPath);
    } else {
      setPendingFolder(folderPath);
    }
  };

  const handleClearWorkspace = () => {
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
        const [cliPayload, mcpPayload] = await Promise.all([
          fetchCliApps(token, base),
          fetchMcpPresets(token, base),
        ]);
        if (cancelled) return;
        setCliApps(cliPayload.apps.filter((app) => app.installed && app.available));
        setMcpPresets(mcpPayload.presets.filter((preset) => preset.configured && preset.available));
      } catch {
        if (!cancelled) {
          setCliApps([]);
          setMcpPresets([]);
        }
      }
    };
    loadCapabilities();
    return () => {
      cancelled = true;
    };
  }, []);

  // Suggestion type tracking: 'skill' for / prefix, 'agent' for @ prefix
  const suggestionType = useMemo((): 'skill' | 'agent' | null => {
    const trimmed = text.trim();
    if (!selectedSkill && !selectedAgent) {
      if (trimmed.startsWith('@')) return 'agent';
      if (trimmed.startsWith('/')) return 'skill';
    }
    return null;
  }, [text, selectedSkill, selectedAgent]);

  // Skill/Agent suggestions
  const suggestions = useMemo((): SuggestionItem[] => {
    const trimmed = text.trim();

    // Agent suggestions when typing @
    if (suggestionType === 'agent') {
      const query = trimmed.slice(1).toLowerCase();
      const agentItems: SuggestionItem[] = agents
        .filter((a) => a.name !== 'ruyi')
        .filter((a) => {
          if (!query) return true;
          return a.name.toLowerCase().includes(query) ||
            a.description.toLowerCase().includes(query);
        })
        .map((a) => ({
          name: a.name,
          description: a.description,
          kind: 'agent' as const,
        }));
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
          kind: 'mcp' as const,
          mcpPreset: preset,
        }));
      return [...agentItems, ...cliItems, ...mcpItems];
    }

    // Skill suggestions when typing /
    if (suggestionType === 'skill') {
      const query = trimmed.slice(1).toLowerCase();
      return skills
        .filter((s) => s.userInvocable !== false)
        .filter((s) => {
          if (!query) return true;
          const tagStr = (s.tags ?? []).join(' ').toLowerCase();
          return s.name.toLowerCase().includes(query) ||
            s.description.toLowerCase().includes(query) ||
            tagStr.includes(query);
        })
        .map((s) => ({
          name: s.name,
          description: s.description,
          trigger: s.trigger,
          kind: 'skill' as const,
        }));
    }
    return [];
  }, [text, skills, agents, suggestionType, cliApps, mcpPresets, selectedCliApps, selectedMcpPresets]);

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
    } else if (suggestionType === 'agent') {
      setSelectedAgent(item);
    } else {
      setSelectedSkill(item);
    }
    setText('');
    setSuggestionsDismissed(true);
    textareaRef.current?.focus();
  };

  const removeSkill = () => {
    setSelectedSkill(null);
    textareaRef.current?.focus();
  };

  const removeAgent = () => {
    setSelectedAgent(null);
    textareaRef.current?.focus();
  };

  const resetInput = () => {
    setText('');
    setImages([]);
    setFiles([]);
    setSelectedSkill(null);
    setSelectedAgent(null);
    setSelectedCliApps([]);
    setSelectedMcpPresets([]);
    setSuggestionsDismissed(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if ((!trimmed && !selectedSkill && !selectedAgent && selectedCliApps.length === 0 && selectedMcpPresets.length === 0 && images.length === 0 && files.length === 0) || disabled) return;

    // Build file context prefix
    const fileContext = files.length > 0
      ? files.map((f) => `[Attachment: \`${f.path}\`]`).join('\n')
      : '';

    const capabilityMentions = [
      ...selectedCliApps.map((app) => `@${app.name}`),
      ...selectedMcpPresets.map((preset) => `@${preset.name}`),
    ].join(' ');

    // Compose parts, then join with newline
    const bodyParts = [fileContext, capabilityMentions, trimmed].filter(Boolean).join('\n');

    let message: string;
    if (selectedAgent) {
      message = `@${selectedAgent.name}${bodyParts ? ' ' + bodyParts : ''}`;
    } else if (selectedSkill) {
      message = `/${selectedSkill.name}${bodyParts ? ' ' + bodyParts : ''}`;
    } else {
      message = bodyParts;
    }

    onSend(
      message,
      images.length > 0 ? images : undefined,
      isWelcome ? localWorkspace : undefined,
      {
        ...(selectedCliApps.length ? { cliApps: selectedCliApps } : {}),
        ...(selectedMcpPresets.length ? { mcpPresets: selectedMcpPresets } : {}),
      },
    );
    resetInput();
  };

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
    // Backspace with empty text removes selected skill or agent
    if (selectedAgent) {
      if (e.key === 'Backspace' && text === '') {
        e.preventDefault();
        removeAgent();
        return;
      }
    }
    if (selectedSkill) {
      if (e.key === 'Backspace' && text === '') {
        e.preventDefault();
        removeSkill();
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

  const handleAttach = async () => {
    const selected = await dialogBridge.open({ multiple: true, directory: false });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      await processFilePaths(
        paths,
        (imgs) => setImages((prev) => [...prev, ...imgs]),
        (items) => setFiles((prev) => [...prev, ...items]),
      );
      textareaRef.current?.focus();
    }
  };

  const hasAttachments = images.length > 0 || files.length > 0;
  const hasContent = text.trim().length > 0 || selectedSkill !== null || selectedAgent !== null || selectedCliApps.length > 0 || selectedMcpPresets.length > 0 || hasAttachments;

  // Determine placeholder based on selected command
  const placeholder = disabled
    ? t.chat.inputPlaceholderBusy
    : isRunning
      ? t.chat.inputPlaceholderMidTask
      : selectedAgent
        ? selectedAgent.description
        : selectedSkill
          ? selectedSkill.description
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
        {/* Suggestions Popup (Skills / Agents) */}
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
                    suggestionType === 'agent' ? 'text-[#656358]' : 'text-[#656358]'
                  )}>
                    {suggestionType === 'agent' ? '@' : '/'}
                  </span>
                  <span className="font-medium text-[#29261b] text-[13px]">{item.name}</span>
                  {item.kind === 'cli' && (
                    <span className="rounded bg-[#eef2ff] px-1.5 py-0.5 text-[10px] font-medium text-[#4f46e5]">CLI</span>
                  )}
                  {item.kind === 'mcp' && (
                    <span className="rounded bg-[#ecfdf5] px-1.5 py-0.5 text-[10px] font-medium text-[#047857]">MCP</span>
                  )}
                  {item.kind === 'agent' && (
                    <span className="rounded bg-[#f3f2ee] px-1.5 py-0.5 text-[10px] font-medium text-[#656358]">Agent</span>
                  )}
                  <span className="text-[12px] text-[#656358] truncate">{item.description}</span>
                </div>
                {item.trigger && (
                  <div className="pl-8 text-[11px] text-[#656358]/70 truncate">
                    TRIGGER: {item.trigger}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Input Card */}
        <div
          className={cn(
            'relative claude-elevated claude-input-focus rounded-[24px] transition-all',
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
            {selectedAgent && (
              <button
                onClick={removeAgent}
                className="shrink-0 mt-[3px] mr-1.5 text-[14px] font-medium text-blue-600 hover:text-blue-800 hover:line-through transition-colors cursor-pointer"
                title={t.common.close}
              >
                @{selectedAgent.name}
              </button>
            )}
            {selectedSkill && (
              <button
                onClick={removeSkill}
                className="shrink-0 mt-[3px] mr-1.5 text-[14px] font-medium text-purple-600 hover:text-purple-800 hover:line-through transition-colors cursor-pointer"
                title={t.common.close}
              >
                /{selectedSkill.name}
              </button>
            )}
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
                'flex-1 bg-transparent resize-none outline-none text-[#29261b] leading-relaxed placeholder:text-[#8f8b82]',
                isWelcome
                  ? 'min-h-[64px] max-h-[180px] text-[18px]'
                  : 'min-h-[28px] max-h-[160px] py-0.5 text-[15px] disabled:opacity-40'
              )}
            />
          </div>

          {/* Bottom Toolbar */}
          {isWelcome ? (
            /* Welcome variant: FolderSelector + [+] + --- + Start button */
            <div className="flex items-center gap-2 px-5 pb-4">
              <FolderSelector
                currentPath={localWorkspace}
                recentPaths={recentPaths}
                onSelect={handleSelectFolder}
                onClear={handleClearWorkspace}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={handleAttach}
                aria-label={t.chat.addAttachment}
                className="btn-ghost h-8 w-8 text-[#29261b] hover:text-[#29261b] hover:bg-[#eeeeea] rounded-xl"
              >
                <Plus className="h-4 w-4" />
              </Button>
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
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleAttach}
                  aria-label={t.chat.addAttachment}
                  className="btn-ghost h-8 w-8 text-[#29261b] hover:text-[#29261b] hover:bg-[#eeeeea] rounded-xl"
                >
                  <Plus className="h-4 w-4" />
                </Button>
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
                  <Button
                    size="icon"
                    onClick={handleStop}
                    aria-label={t.chat.stop}
                    className="btn-claude-primary h-8 w-8 rounded-xl bg-red-500 hover:bg-red-600 text-white shadow-sm"
                    title={t.chat.stop}
                  >
                    <Square className="h-3 w-3" fill="currentColor" />
                  </Button>
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
      </div>
    </>
  );
}
