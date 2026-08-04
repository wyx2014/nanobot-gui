import {
  Folder,
  ListTodo,
  PanelBottom,
  PanelRight,
} from 'lucide-react';

import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';

interface ConversationHeaderProps {
  conversationTitle: string;
  onScrollToBottom: () => void;
}

const iconButtonClassName =
  'window-titlebar-no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[#77746b] transition-colors hover:bg-[#efeeeb] hover:text-[#29261b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/35 dark:text-[#aaa69e] dark:hover:bg-white/10 dark:hover:text-white';

export default function ConversationHeader({
  conversationTitle,
  onScrollToBottom,
}: ConversationHeaderProps) {
  const { locale, t } = useI18n();
  const summaryCollapsed = useSettingsStore((state) => state.rightPanelCollapsed);
  const toggleSummary = useSettingsStore((state) => state.toggleRightPanel);
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useSettingsStore((state) => state.toggleSidebar);
  const isZh = locale.startsWith('zh');
  const titleLabel = conversationTitle.trim() || (isZh ? '新会话' : 'New conversation');
  const titleCharacters = Array.from(titleLabel);
  const visibleTitle = titleCharacters.length > 15
    ? `${titleCharacters.slice(0, 15).join('')}...`
    : titleLabel;

  return (
    <header
      data-conversation-header
      className="window-titlebar-drag relative z-[45] flex h-12 shrink-0 items-center justify-between gap-4 border-b border-[#e8e6e1] bg-[#fbfaf7]/96 px-3 backdrop-blur-xl dark:border-white/10 dark:bg-[#1f1f1f]/96"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Folder
          className="h-[17px] w-[17px] shrink-0 text-[#5f5c54] dark:text-[#b9b5ad]"
          strokeWidth={1.8}
        />
        <span
          className="min-w-0 truncate text-[13px] font-medium text-[#38352e] dark:text-[#e5e1d9]"
          title={titleLabel}
        >
          {visibleTitle}
        </span>
      </div>

      <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
        <button
          type="button"
          data-pinned-summary-toggle
          onClick={toggleSummary}
          aria-expanded={!summaryCollapsed}
          aria-controls="conversation-pinned-summary"
          aria-label={t.panel.pinnedSummary}
          title={t.panel.pinnedSummary}
          className={cn(
            iconButtonClassName,
            !summaryCollapsed && 'bg-[#ecebe7] text-[#29261b] dark:bg-white/10 dark:text-white',
          )}
        >
          <ListTodo className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>

        <button
          type="button"
          data-conversation-header-scroll-bottom
          onClick={onScrollToBottom}
          className={iconButtonClassName}
          aria-label={t.chat.scrollToBottom}
          title={t.chat.scrollToBottom}
        >
          <PanelBottom className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>

        <button
          type="button"
          data-conversation-header-sidebar
          onClick={toggleSidebar}
          className={cn(
            iconButtonClassName,
            !sidebarCollapsed && 'text-[#5f5c54] dark:text-[#c8c4bc]',
          )}
          aria-label={sidebarCollapsed ? t.sidebar.showSidebar : t.sidebar.hideSidebar}
          title={sidebarCollapsed ? t.sidebar.showSidebar : t.sidebar.hideSidebar}
        >
          <PanelRight className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}
