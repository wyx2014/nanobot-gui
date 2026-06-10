import { ChevronDown, ChevronRight, Copy, Pencil, RefreshCw, Check, Brain, Wand2, AtSign, X, ArrowUp } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import type { Message, MessageContent } from '@/types';
import MarkdownRenderer from './MarkdownRenderer';
import ToolCallsGroup from './ToolCallsGroup';
import { useChatStore, useActiveConversation } from '@/stores/chatStore';
import { usePreviewStore } from '@/stores/previewStore';
import { runAgentLoop } from '@/core/agent/agentLoop';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import ruyiAvatar from '@/assets/ruyi-avatar.png';

// Helper to get text content from Message
function getTextContent(content: string | MessageContent[]): string {
  if (typeof content === 'string') return content;
  const textBlock = content.find((c) => c.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

// Helper to get image blocks from Message content
function getImageBlocks(content: string | MessageContent[]): Extract<MessageContent, { type: 'image' }>[] {
  if (typeof content === 'string') return [];
  return content.filter((c): c is Extract<MessageContent, { type: 'image' }> => c.type === 'image');
}

// Thinking block component for extended thinking
function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useI18n();

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-[#706b5730] bg-[#f5f3ee] max-w-full">
      <button
        onClick={() => setExpanded(!expanded)}
        className="btn-ghost w-full flex items-center gap-2 px-3.5 py-2.5 text-sm hover:bg-[#e8e5de]"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-[#656358] shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[#656358] shrink-0" />
        )}
        <Brain className="h-3.5 w-3.5 text-purple-500 shrink-0" />
        <span className="text-[13px] font-medium text-[#29261b]">{t.chat.thinkingProcess}</span>
      </button>
      {expanded && (
        <div className="border-t border-[#706b5730] px-4 py-3">
          <pre className="text-[12px] text-[#656358] whitespace-pre-wrap break-words leading-relaxed">
            {thinking}
          </pre>
        </div>
      )}
    </div>
  );
}

// Message action toolbar
interface MessageActionsProps {
  message: Message;
  onEdit: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
  isUser: boolean;
}

function MessageActions({ message, onEdit, onRegenerate, isUser }: Omit<MessageActionsProps, 'onDelete'>) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = getTextContent(message.content);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn(
      "flex items-center gap-0.5 transition-opacity",
      !isUser ? "opacity-100" : "opacity-0 group-hover:opacity-100"
    )}>
      {/* Copy button */}
      <button
        onClick={handleCopy}
        className="btn-ghost p-1.5 rounded-md text-[#656358] hover:text-[#29261b] hover:bg-[#e8e5de]"
        title={t.chat.copy}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>

      {/* Edit button - only for user messages */}
      {isUser && (
        <button
          onClick={onEdit}
          className="btn-ghost p-1.5 rounded-md text-[#656358] hover:text-[#29261b] hover:bg-[#e8e5de]"
          title={t.chat.edit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Regenerate button - only for assistant messages */}
      {!isUser && (
        <button
          onClick={onRegenerate}
          className="btn-ghost p-1.5 rounded-md text-[#656358] hover:text-[#29261b] hover:bg-[#e8e5de]"
          title={t.chat.regenerate}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}

    </div>
  );
}

// Edit input for user messages — card style
function EditInput({
  initialContent,
  onSave,
  onCancel
}: {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialContent);
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow height logic
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
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
    <div className="flex items-end gap-2 w-full">
      {/* Cancel button - X icon */}
      <button
        onClick={onCancel}
        className="p-1.5 rounded-full text-[#656358] hover:bg-[#706b5710] transition-colors shrink-0 mb-1"
        title={t.common.cancel}
      >
        <X className="h-5 w-5" />
      </button>

      {/* Input field area - rounded-2xl for multi-line */}
      <div className="flex-1 flex items-end gap-2 px-4 py-2 bg-white rounded-2xl border-2 border-[#1a73e8] shadow-sm min-h-[44px]">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent text-[14.5px] text-[#29261b] outline-none border-none py-1.5 resize-none leading-relaxed overflow-hidden"
          placeholder={t.chat.inputPlaceholder}
          autoFocus
          rows={1}
        />
        
        {/* Submit button - ArrowUp in blue circle */}
        <button
          onClick={() => onSave(text)}
          disabled={!text.trim()}
          className="p-1.5 rounded-full bg-[#1a73e8] text-white hover:bg-[#1557b0] transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed mb-1"
          title={t.chat.saveAndResend}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// User message context menu
function MessageContextMenu({
  x,
  y,
  onClose,
  onCopy,
  onEdit,
  t
}: {
  x: number;
  y: number;
  onClose: () => void;
  onCopy: () => void;
  onEdit?: () => void;
  t: any
}) {
  return (
    <div
      className="fixed z-[100] bg-white rounded-xl border border-[#706b5730] shadow-xl py-1.5 min-w-[140px] animate-in fade-in zoom-in duration-100"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        onClick={() => {
          onCopy();
          onClose();
        }}
        className="flex items-center gap-2.5 w-full px-3.5 py-2 text-sm text-[#29261b] hover:bg-[#d97757]/10 hover:text-[#d97757] transition-colors font-medium text-left"
      >
        <Copy className="h-4 w-4 text-[#656358]" />
        <span>{t.chat.copy}</span>
      </button>
      {onEdit && (
        <button
          onClick={() => {
            onEdit();
            onClose();
          }}
          className="flex items-center gap-2.5 w-full px-3.5 py-2 text-sm text-[#29261b] hover:bg-[#d97757]/10 hover:text-[#d97757] transition-colors font-medium text-left"
        >
          <Pencil className="h-4 w-4 text-[#656358]" />
          <span>{t.chat.edit}</span>
        </button>
      )}
    </div>
  );
}

export default function MessageBubble({
  message,
  hideAvatar = false,
  actionsOnly = false
}: {
  message: Message;
  hideAvatar?: boolean;
  actionsOnly?: boolean;
}) {
  const { t } = useI18n();
  const isUser = message.role === 'user';
  const [isEditing, setIsEditing] = useState(false);
  const activeConv = useActiveConversation();
  const { deleteMessagesFrom } = useChatStore();
  const isConvRunning = activeConv?.status === 'running';
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!isUser) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    const handleScroll = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      document.addEventListener('contextmenu', handleClick);
      window.addEventListener('scroll', handleScroll, true);
    }
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('contextmenu', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [contextMenu]);

  const textContent = getTextContent(message.content);
  const imageBlocks = getImageBlocks(message.content);
  const convId = activeConv?.id;

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSaveEdit = async (newContent: string) => {
    if (!convId) return;
    // Preserve image blocks from original message content
    const originalImages = getImageBlocks(message.content);
    setIsEditing(false);
    // Delete this message and all subsequent messages, then runAgentLoop creates a fresh one
    deleteMessagesFrom(convId, message.id);
    // Regenerate response, passing original images if any
    const imageAttachments = originalImages.map((img, i) => ({
      id: `edit-${Date.now()}-${i}`,
      data: img.source.data,
      mediaType: img.source.media_type,
    }));
    await runAgentLoop(convId, newContent, imageAttachments.length > 0 ? { images: imageAttachments } : undefined);
  };



  const handleRegenerate = async () => {
    if (!convId || !activeConv) return;
    const messages = activeConv.messages;

    // Find the user message to regenerate from
    // If this message has a loopId, find the user message with the same loopId
    // Otherwise, fall back to finding the previous user message
    let userMsgToRegenerate: Message | undefined;

    if (message.loopId) {
      // Find user message with the same loopId
      userMsgToRegenerate = messages.find(
        (m) => m.role === 'user' && m.loopId === message.loopId
      );
    }

    if (!userMsgToRegenerate) {
      // Fallback: find the previous user message by index
      const idx = messages.findIndex((m) => m.id === message.id);
      if (idx > 0) {
        userMsgToRegenerate = messages
          .slice(0, idx)
          .reverse()
          .find((m) => m.role === 'user');
      }
    }

    if (userMsgToRegenerate) {
      // Delete from user message onwards and regenerate
      deleteMessagesFrom(convId, userMsgToRegenerate.id);
      const userContent = getTextContent(userMsgToRegenerate.content);
      // Preserve image blocks from original user message
      const originalImages = getImageBlocks(userMsgToRegenerate.content);
      const imageAttachments = originalImages.map((img, i) => ({
        id: `regen-${Date.now()}-${i}`,
        data: img.source.data,
        mediaType: img.source.media_type,
      }));
      await runAgentLoop(convId, userContent, imageAttachments.length > 0 ? { images: imageAttachments } : undefined);
    }
  };

  // Actions only mode - just render the action buttons
  if (actionsOnly && !isUser) {
    return (
      <MessageActions
        message={message}
        onEdit={() => {}}
        onRegenerate={handleRegenerate}
        isUser={false}
      />
    );
  }

  if (isUser) {
    const openPreview = usePreviewStore.getState().openPreview;
    return (
      <div className={cn("flex justify-end w-full group", isEditing && "justify-center")}>
        <div className={cn(
          "flex flex-col gap-1.5",
          isUser ? "items-end" : "items-start",
          isEditing ? "w-full" : "max-w-[85%]"
        )}>
          {/* Image thumbnails — above the text bubble */}
          {imageBlocks.length > 0 && !isEditing && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {imageBlocks.map((img, idx) => {
                const dataUrl = `data:${img.source.media_type};base64,${img.source.data}`;
                return (
                  <div
                    key={idx}
                    className="w-8 h-8 rounded overflow-hidden border border-[#e5e2db] cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => openPreview(dataUrl)}
                    title={t.chat.clickToViewFull}
                  >
                    <img
                      src={dataUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                );
              })}
            </div>
          )}
          {/* Delegate agent badge — above the bubble */}
          {message.delegateAgent && (
            <div className="flex items-center justify-end gap-1 text-[#9a9689]">
              <AtSign className="h-3 w-3" />
              <span className="text-[11px] font-medium">{message.delegateAgent.name}</span>
            </div>
          )}
          {isEditing ? (
            <div className="w-full flex justify-end">
              <EditInput
                initialContent={textContent}
                onSave={handleSaveEdit}
                onCancel={() => setIsEditing(false)}
              />
            </div>
          ) : (
            <div className="flex items-start gap-2">
              {/* Actions - show on hover */}
              {!isConvRunning && (
                <MessageActions
                  message={message}
                  onEdit={handleEdit}
                  onRegenerate={handleRegenerate}
                  isUser={true}
                />
              )}
              <div
                onContextMenu={handleContextMenu}
                className="px-4 py-2.5 rounded-2xl rounded-br-sm bg-[#d97757] text-white shadow-sm cursor-default"
              >
                {/* Skill badge inside bubble */}
                {message.skill && (
                  <div className="flex items-center gap-1.5 mb-1.5 opacity-90">
                    <Wand2 className="h-3 w-3" />
                    <span className="text-[11px] font-medium">/{message.skill.name}</span>
                  </div>
                )}
                {textContent && (
                  <div className="text-[14.5px] leading-relaxed break-words">
                    <MarkdownRenderer content={textContent} variant="user" />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {contextMenu && (
          <MessageContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onCopy={async () => {
              const text = getTextContent(message.content);
              await navigator.clipboard.writeText(text);
            }}
            onEdit={handleEdit}
            t={t}
          />
        )}
      </div>
    );
  }

  // Assistant message - when hideAvatar is true, render content only (used in MessageGroup)
  if (hideAvatar) {
    return (
      <div className="assistant-turn">
        {/* Thinking block if present */}
        {message.thinking && <ThinkingBlock thinking={message.thinking} />}

        {textContent && (
          <div className="text-[#29261b] break-words">
            <MarkdownRenderer content={textContent} />
          </div>
        )}
        {/* Tool calls - grouped in a single collapsible block */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallsGroup toolCalls={message.toolCalls} />
        )}
        {message.isStreaming && <span className="streaming-cursor" />}



        {/* Actions - show on hover when not streaming */}
        {!message.isStreaming && !isConvRunning && (
          <div className="mt-2">
            <MessageActions
              message={message}
              onEdit={() => {}}
              onRegenerate={handleRegenerate}
              isUser={false}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-3 w-full overflow-hidden group">
      {/* RUYI Avatar - 小布丁人 */}
      <div className="shrink-0 mt-0.5">
        <div className="w-7 h-7 rounded-full overflow-hidden">
          <img src={ruyiAvatar} alt="Ruyi" className="w-full h-full object-cover" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {/* Thinking block if present */}
        {message.thinking && <ThinkingBlock thinking={message.thinking} />}

        {textContent && (
          <div className="text-[#29261b] break-words">
            <MarkdownRenderer content={textContent} />
          </div>
        )}
        {/* Tool calls - grouped in a single collapsible block */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallsGroup toolCalls={message.toolCalls} />
        )}
        {message.isStreaming && <span className="streaming-cursor" />}



        {/* Actions - show on hover when not streaming */}
        {!message.isStreaming && !isConvRunning && (
          <div className="mt-2">
            <MessageActions
              message={message}
              onEdit={() => {}}
              onRegenerate={handleRegenerate}
              isUser={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
