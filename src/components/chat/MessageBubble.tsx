import { Check, Copy, Pencil, Plug, Terminal, Wand2, X, ArrowUp, ChevronRight, Wrench } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message, MessageContent } from '@/types';
import MarkdownRenderer from './MarkdownRenderer';
import { useActiveConversation } from '@/stores/chatStore';
import { useI18n } from '@/i18n';
import { displaySkillName } from '@/core/skills/filter';
import { cn } from '@/lib/utils';
import { stripDuplicateHtmlArtifactReference } from '@/core/nanobot/htmlArtifactDedup';
import { MessageMedia, UserImageGrid } from './MessageMedia';

function getTextContent(content: string | MessageContent[]): string {
  if (typeof content === 'string') return content;
  const textBlock = content.find((c) => c.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

function getImageBlocks(content: string | MessageContent[]): Extract<MessageContent, { type: 'image' }>[] {
  if (typeof content === 'string') return [];
  return content.filter((c): c is Extract<MessageContent, { type: 'image' }> => c.type === 'image');
}

function mcpPresetName(
  preset: NonNullable<Message['mcpPresets']>[number],
): string {
  return preset.display_name || preset.name;
}

export function formatAssistantCompletedAt(
  value?: number,
  nowValue = Date.now(),
): string | null {
  const timestamp = normalizeTimestamp(value);
  const nowTimestamp = normalizeTimestamp(nowValue);
  if (timestamp === undefined || nowTimestamp === undefined) return null;

  const date = new Date(timestamp);
  const now = new Date(nowTimestamp);
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (isSameLocalDay(date, now)) return time;
  if (startOfLocalWeek(date).getTime() === startOfLocalWeek(now).getTime()) {
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return `${weekdays[date.getDay()]}${time}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function normalizeTimestamp(value?: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value >= 1_000_000_000_000 ? value : value * 1000;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function startOfLocalWeek(value: Date): Date {
  const result = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const daysSinceMonday = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - daysSinceMonday);
  return result;
}

function EditInput({
  initialContent,
  onSave,
  onCancel,
}: {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialContent);
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [text]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSave(text);
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="flex w-full items-end gap-2">
      <button
        onClick={onCancel}
        className="mb-1 shrink-0 rounded-full p-1.5 text-[#656358] transition-colors hover:bg-[#706b5710]"
        title={t.common.cancel}
      >
        <X className="h-5 w-5" />
      </button>
      <div className="flex min-h-[44px] flex-1 items-end gap-2 rounded-2xl border border-[#dedbd3] bg-white px-4 py-2 shadow-sm focus-within:border-[#8f8b82]">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 resize-none overflow-hidden border-none bg-transparent py-1.5 text-[14.5px] leading-relaxed text-[#29261b] outline-none font-user-message"
          placeholder={t.chat.inputPlaceholder}
          autoFocus
          rows={1}
        />
        <button
          onClick={() => onSave(text)}
          disabled={!text.trim()}
          className="mb-1 shrink-0 rounded-full bg-[#29261b] p-1.5 text-white transition-colors hover:bg-[#3d3929] disabled:cursor-not-allowed disabled:opacity-50"
          title={t.chat.saveAndResend}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function UserContextMenu({
  x,
  y,
  onClose,
  onCopy,
  onEdit,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onCopy: () => void;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="fixed z-[100] min-w-[140px] rounded-xl border border-[#706b5730] bg-white py-1.5 shadow-xl animate-in fade-in zoom-in duration-100"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        onClick={() => {
          onCopy();
          onClose();
        }}
        className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm font-medium text-[#29261b] transition-colors hover:bg-[#d97757]/10 hover:text-[#d97757]"
      >
        <Copy className="h-4 w-4 text-[#656358]" />
        <span>{t.chat.copy}</span>
      </button>
      <button
        onClick={() => {
          onEdit();
          onClose();
        }}
        className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm font-medium text-[#29261b] transition-colors hover:bg-[#d97757]/10 hover:text-[#d97757]"
      >
        <Pencil className="h-4 w-4 text-[#656358]" />
        <span>{t.chat.edit}</span>
      </button>
    </div>
  );
}

function TraceGroup({ message }: { message: Message }) {
  const lines = message.traces?.length
    ? message.traces
    : typeof message.content === 'string' && message.content.trim()
      ? [message.content]
      : [];
  const [open, setOpen] = useState(false);
  if (!lines.length) return null;
  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[#656358] transition-colors hover:bg-[#e8e5de]/60"
        aria-expanded={open}
      >
        <Wrench className="h-3.5 w-3.5" />
        <span className="font-medium">{lines.length === 1 ? '1 tool step' : `${lines.length} tool steps`}</span>
        <ChevronRight className={cn('ml-auto h-3.5 w-3.5 transition-transform duration-200', open && 'rotate-90')} />
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 border-l border-[#706b5730] pl-3 animate-in fade-in-0 slide-in-from-top-1 duration-200">
          {lines.map((line, index) => (
            <li key={index} className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-[#656358]">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Assistant typing">
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[#8b887c]" />
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[#8b887c]" style={{ animationDelay: '150ms' }} />
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[#8b887c]" style={{ animationDelay: '300ms' }} />
    </span>
  );
}

export default function MessageBubble({
  message,
  showAssistantCopyAction = true,
  isLastAssistantReply = false,
  onEditUserMessage,
}: {
  message: Message;
  showAssistantCopyAction?: boolean;
  isLastAssistantReply?: boolean;
  onEditUserMessage?: (message: Message, newContent: string) => void;
}) {
  const { t } = useI18n();
  const isUser = message.role === 'user';
  const textContent = getTextContent(message.content);
  const imageBlocks = getImageBlocks(message.content);
  const mediaAttachments = message.mediaAttachments ?? [];
  const visibleTextContent = isUser
    ? textContent
    : stripDuplicateHtmlArtifactReference(textContent, mediaAttachments);
  const mcpPresets = message.mcpPresets ?? [];
  const primaryMcpPreset = mcpPresets[0];
  const hiddenMcpPresets = mcpPresets.slice(1);
  const activeConv = useActiveConversation();
  const isConvRunning = activeConv?.status === 'running';

  const [isEditing, setIsEditing] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    };
  }, []);

  useEffect(() => {
    const handleClose = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClose);
      document.addEventListener('contextmenu', handleClose);
      window.addEventListener('scroll', handleClose, true);
    }
    return () => {
      document.removeEventListener('click', handleClose);
      document.removeEventListener('contextmenu', handleClose);
      window.removeEventListener('scroll', handleClose, true);
    };
  }, [contextMenu]);

  const copyText = useCallback(async () => {
    await navigator.clipboard.writeText(visibleTextContent);
    setCopied(true);
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => {
      setCopied(false);
      copyResetRef.current = null;
    }, 1500);
  }, [visibleTextContent]);

  const handleSaveEdit = async (newContent: string) => {
    setIsEditing(false);
    onEditUserMessage?.(message, newContent);
  };

  if (message.kind === 'trace' || message.role === 'tool') {
    return <TraceGroup message={message} />;
  }

  if (isUser) {
    return (
      <div
        data-message-bubble
        data-message-role="user"
        className={cn(
          'group ml-auto flex max-w-[min(85%,36rem)] flex-col items-end gap-1.5',
          isEditing && 'max-w-full',
        )}
      >
        {imageBlocks.length > 0 && !isEditing ? <UserImageGrid images={imageBlocks} /> : null}
        {mediaAttachments.length > 0 ? <MessageMedia media={mediaAttachments} align="right" /> : null}

        {(message.delegateAgent || !!message.cliApps?.length || !!message.skills?.length || !!message.mcpPresets?.length) && !isEditing && (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {message.skill && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f2efe9] px-2 py-0.5 text-[11px] font-medium text-[#6b685e] dark:bg-[#4a4a4a] dark:text-[#e2ded5]">
                <Wand2 className="h-3 w-3" />
                /{message.skill.name}
              </span>
            )}
            {message.skills?.map((skillName) => (
              <span key={`skill-${skillName}`} className="inline-flex items-center gap-1 rounded-full bg-[#f2efe9] px-2 py-0.5 text-[11px] font-medium text-[#6b685e] dark:bg-[#4a4a4a] dark:text-[#e2ded5]">
                <Wand2 className="h-3 w-3" />
                /{displaySkillName(skillName)}
              </span>
            ))}
            {message.cliApps?.map((app) => (
              <span key={`cli-${app.name}`} className="inline-flex items-center gap-1 rounded-full bg-[#f2efe9] px-2 py-0.5 text-[11px] font-medium text-[#6b685e] dark:bg-[#4a4a4a] dark:text-[#e2ded5]">
                <Terminal className="h-3 w-3" />
                {app.display_name || app.name}
              </span>
            ))}
            {primaryMcpPreset ? (
              <span data-mcp-preset-chip className="inline-flex items-center gap-1 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[11px] font-medium text-[#047857] dark:bg-[#1f3a33] dark:text-[#6ee7b7]">
                <Plug className="h-3 w-3" />
                {mcpPresetName(primaryMcpPreset)}
              </span>
            ) : null}
            {hiddenMcpPresets.length > 0 ? (
              <span
                data-mcp-preset-overflow
                className="inline-flex items-center rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#047857] dark:bg-[#1f3a33] dark:text-[#6ee7b7]"
                title={hiddenMcpPresets.map(mcpPresetName).join('\n')}
                aria-label={`${hiddenMcpPresets.length} more MCP connectors: ${hiddenMcpPresets.map(mcpPresetName).join(', ')}`}
              >
                +{hiddenMcpPresets.length}
              </span>
            ) : null}
          </div>
        )}

        {isEditing ? (
          <div className="w-full">
            <EditInput initialContent={textContent} onSave={handleSaveEdit} onCancel={() => setIsEditing(false)} />
          </div>
        ) : textContent ? (
          <div className="flex items-start gap-2">
            {!isConvRunning && (
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={copyText}
                  className="rounded-md p-1.5 text-[#656358] hover:bg-[#e8e5de] hover:text-[#29261b]"
                  title={t.chat.copy}
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => setIsEditing(true)}
                  className="rounded-md p-1.5 text-[#656358] hover:bg-[#e8e5de] hover:text-[#29261b]"
                  title={t.chat.edit}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setContextMenu({ x: event.clientX, y: event.clientY });
              }}
              className="ml-auto w-fit rounded-[18px] bg-[#efede8] px-4 py-2 text-left text-[16px]/[1.75] text-[#191814] whitespace-pre-wrap break-words font-user-message"
            >
              <MarkdownRenderer content={textContent} variant="user" />
            </div>
          </div>
        ) : null}

        {contextMenu && (
          <UserContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onCopy={copyText}
            onEdit={() => setIsEditing(true)}
          />
        )}
      </div>
    );
  }

  const empty = visibleTextContent.trim().length === 0;
  const showAssistantActions = message.role === 'assistant' && !message.isStreaming && !empty;
  const completedAt = formatAssistantCompletedAt(message.completedAt ?? message.timestamp);
  const showFooter = showAssistantCopyAction && showAssistantActions;

  return (
    <div
      data-message-bubble
      data-message-role="assistant"
      data-streaming={message.isStreaming ? 'true' : 'false'}
      className={cn(
        'group/assistant w-full text-[15px] leading-[1.78]',
        message.isStreaming
          && 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200',
      )}
    >
      {empty && message.isStreaming ? (
        <TypingDots />
      ) : (
        <>
          {visibleTextContent ? (
            <div className="text-[#29261b] break-words">
              <MarkdownRenderer content={visibleTextContent} />
            </div>
          ) : null}
          {mediaAttachments.length > 0 ? (
            <MessageMedia
              media={mediaAttachments}
              align="left"
              visibility="html-only"
            />
          ) : null}
          {message.isStreaming && visibleTextContent ? <span className="streaming-cursor" /> : null}
          {showFooter ? (
            <div
              data-testid="assistant-reply-actions"
              className={cn(
                'mt-2 flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 text-[#8b887c] transition-opacity duration-150',
                isLastAssistantReply
                  ? 'opacity-100'
                  : 'pointer-events-none opacity-0 group-hover/assistant:pointer-events-auto group-hover/assistant:opacity-100 group-focus-within/assistant:pointer-events-auto group-focus-within/assistant:opacity-100',
              )}
            >
              {showAssistantCopyAction && showAssistantActions ? (
                <>
                  <button
                    type="button"
                    onClick={copyText}
                    aria-label={copied ? 'Copied' : 'Copy reply'}
                    title={copied ? 'Copied' : 'Copy reply'}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[#e8e5de] hover:text-[#29261b]"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </>
              ) : null}
              {completedAt ? (
                <span className="text-[11px] leading-none text-[#8b887c]/75 tabular-nums">
                  {completedAt}
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
