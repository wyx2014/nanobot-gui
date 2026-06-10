import { useLayoutEffect, useSyncExternalStore } from 'react';
import { useChatStore, useActiveConversation } from '@/stores/chatStore';
import type { Message, ImageAttachment } from '@/types';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { runAgentLoop, getPendingCommandConfirmation, resolveCommandConfirmation, subscribeToCommandConfirmation, getPendingFilePermission, resolveFilePermission, subscribeToFilePermission } from '@/core/agent/agentLoop';
import { useSettingsStore } from '@/stores/settingsStore';
import type { PermissionDuration } from '@/stores/permissionStore';
import { useI18n } from '@/i18n';
import MessageGroup from './MessageGroup';
import ChatInput from './ChatInput';
import ActiveSkillsBar from './ActiveSkillsBar';
import PermissionDialog from '@/components/common/PermissionDialog';
import CommandConfirmDialog from '@/components/common/CommandConfirmDialog';
import { ChevronDown, Settings } from 'lucide-react';
import ruyiAvatar from '@/assets/ruyi-avatar.png';
import ThinkingIndicator from './ThinkingIndicator';

/**
 * Groups messages by loopId for rendering.
 * Messages with the same loopId are grouped together and rendered as one visual block.
 * Messages without loopId (legacy) are each treated as their own group.
 */
function groupMessagesByLoop(messages: Message[]): Message[][] {
  const groups: Message[][] = [];
  let currentGroup: Message[] = [];
  let currentLoopId: string | undefined | null = null;

  for (const msg of messages) {
    const msgLoopId = msg.loopId;

    // If loopId changes, or message has no loopId (undefined !== undefined should start new group)
    if (!msgLoopId || msgLoopId !== currentLoopId) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = [msg];
      currentLoopId = msgLoopId;
    } else {
      // Same loopId - add to current group
      currentGroup.push(msg);
    }
  }

  // Don't forget the last group
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

export default function ChatView() {
  const activeConv = useActiveConversation();
  const { createConversation } = useChatStore();
  const messages = activeConv?.messages ?? [];
  const { t } = useI18n();

  // Subscribe to command confirmation state using useSyncExternalStore
  const commandConfirmRequest = useSyncExternalStore(
    subscribeToCommandConfirmation,
    getPendingCommandConfirmation
  );

  // Subscribe to file permission requests using useSyncExternalStore
  const filePermissionRequest = useSyncExternalStore(
    subscribeToFilePermission,
    getPendingFilePermission
  );

  const handleCommandConfirm = () => {
    resolveCommandConfirmation(true);
  };

  const handleCommandCancel = () => {
    resolveCommandConfirmation(false);
  };

  const handleFilePermissionAllow = (duration: PermissionDuration) => {
    if (filePermissionRequest) {
      const capabilities: ('read' | 'write' | 'execute')[] =
        filePermissionRequest.capability === 'write'
          ? ['read', 'write', 'execute']
          : ['read'];
      resolveFilePermission(true, filePermissionRequest.path, capabilities, duration);
    }
  };

  const handleFilePermissionDeny = () => {
    resolveFilePermission(false);
  };

  const { containerRef, endRef, isAtBottom, scrollToBottom, resetToBottom } = useAutoScroll();

  // Scroll to bottom when switching conversations.
  // useLayoutEffect runs after DOM commit but before paint,
  // so the user never sees the wrong scroll position.
  const activeConvId = activeConv?.id;
  useLayoutEffect(() => {
    if (activeConvId) {
      scrollToBottom();
    }
  }, [activeConvId, scrollToBottom]);

  const handleSend = async (text: string, images?: ImageAttachment[], workspacePath?: string | null) => {
    // Block sending if API key is not configured
    const currentApiKey = useSettingsStore.getState().apiKey;
    if (!currentApiKey?.trim()) {
      useSettingsStore.getState().openSystemSettings('ai-services');
      return;
    }

    let convId = activeConv?.id;
    const isNewConversation = !convId;
    if (!convId) {
      convId = createConversation(workspacePath);
    }
    // Auto-collapse sidebar when sending first message in a new conversation
    if (isNewConversation && !useSettingsStore.getState().sidebarCollapsed) {
      useSettingsStore.getState().toggleSidebar();
    }
    // Re-enable auto-scroll when user sends a message.
    // Don't scroll immediately — let MutationObserver scroll after the new message renders.
    resetToBottom();
    await runAgentLoop(convId, text, { images });
  };


  // Welcome screen - new conversation state (activeConversationId is null)
  const apiKey = useSettingsStore((s) => s.apiKey);
  const needsSetup = !apiKey?.trim();

  if (!activeConv) {
    return (
      <div className="flex flex-col h-full bg-[#faf9f5]">
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-12">
          <div className="w-full max-w-2xl">
            {/* Title */}
            <div className="text-center mb-8">
              {/* Mascot */}
              <div className="w-20 h-20 mx-auto mb-4 rounded-full overflow-hidden">
                <img src={ruyiAvatar} alt="Ruyi" className="w-full h-full object-cover" />
              </div>

              {/* Slogan */}
              <h1 className="text-[28px] font-semibold text-[#29261b] leading-tight mb-3">
                {t.chat.welcomeTitle}
              </h1>

              {/* Greeting */}
              <p className="text-[15px] text-[#656358] leading-relaxed whitespace-pre-line">
                {t.chat.welcomeSubtitle}
              </p>
            </div>

            {/* First-run setup prompt */}
            {needsSetup && (
              <div className="mb-6 mx-auto max-w-md">
                <div className="rounded-xl border border-[#e8e6df] bg-white/80 px-5 py-4 text-center shadow-sm">
                  <p className="text-[15px] font-medium text-[#29261b] mb-1">
                    {t.chat.setupRequired}
                  </p>
                  <p className="text-[13px] text-[#656358] mb-3">
                    {t.chat.setupRequiredDesc}
                  </p>
                  <button
                    onClick={() => useSettingsStore.getState().openSystemSettings('ai-services')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#D97706] text-white text-[13px] font-medium hover:bg-[#B45309] transition-colors"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    {t.chat.setupButton}
                  </button>
                </div>
              </div>
            )}

            {/* Main input */}
            <div>
              <ChatInput variant="welcome" onSend={handleSend} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Chat view with messages
  // Group messages by loopId for unified rendering
  const messageGroups = groupMessagesByLoop(messages);

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 bg-[#faf9f5]">
      {/* Command Confirmation Dialog */}
      {commandConfirmRequest && (
        <CommandConfirmDialog
          request={commandConfirmRequest.info}
          onConfirm={handleCommandConfirm}
          onCancel={handleCommandCancel}
        />
      )}

      {/* File Permission Dialog */}
      {filePermissionRequest && (
        <PermissionDialog
          request={{
            type: filePermissionRequest.capability === 'write' ? 'file-write' : 'file-read',
            path: filePermissionRequest.path,
          }}
          onAllow={handleFilePermissionAllow}
          onDeny={handleFilePermissionDeny}
        />
      )}

      {/* Messages Area */}
      <div className="relative flex-1 min-h-0 overflow-y-auto" ref={containerRef}>
        <div className="w-full max-w-3xl mx-auto px-6 md:px-10 py-8 overflow-hidden">
          <div className="space-y-10">
            {messageGroups.map((group) => (
              <MessageGroup key={group[0].id} messages={group} />
            ))}

            {/* Thinking indicator - shown after user message but before assistant message appears */}
            {activeConv?.status === 'running' && messages.length > 0 && messages.every((m) => m.role === 'user') && (
              <div className="pl-9">
                <ThinkingIndicator />
              </div>
            )}
          </div>

          {/* Bottom sentinel */}
          <div ref={endRef} className="h-px w-full" />
        </div>

        {/* Scroll-to-bottom button */}
        {!isAtBottom && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 border border-[#706b5730] shadow-md text-[13px] text-[#656358] hover:text-[#29261b] hover:bg-white transition-all backdrop-blur-sm"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            <span>{t.chat.scrollToBottom}</span>
          </button>
        )}
      </div>

      {/* Bottom Input */}
      <div className="shrink-0 px-6 md:px-10 pb-5 pt-2 bg-[#faf9f5]">
        <div className="max-w-3xl mx-auto">
          <ActiveSkillsBar />
          <ChatInput variant="chat" onSend={handleSend} />
          <p className="text-center text-[11px] text-[#656358]/70 mt-2">
            {t.chat.disclaimer}
          </p>
        </div>
      </div>
    </div>
  );
}
