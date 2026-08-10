import {
  Folder,
  ListTodo,
  Terminal,
} from 'lucide-react';

import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSettingsStore } from '@/stores/settingsStore';

interface ConversationHeaderProps {
  conversationTitle: string;
  onOpenTerminal: () => void;
}

const iconButtonClassName =
  'window-titlebar-no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[#77746b] transition-colors hover:bg-[#efeeeb] hover:text-[#29261b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/35 dark:text-[#aaa69e] dark:hover:bg-white/10 dark:hover:text-white';

export default function ConversationHeader({
  conversationTitle,
  onOpenTerminal,
}: ConversationHeaderProps) {
  const { locale, t } = useI18n();
  const summaryCollapsed = useSettingsStore((state) => state.rightPanelCollapsed);
  const toggleSummary = useSettingsStore((state) => state.toggleRightPanel);
  const isZh = locale.startsWith('zh');
  const titleLabel = conversationTitle.trim() || (isZh ? '新会话' : 'New conversation');
  const titleCharacters = Array.from(titleLabel);
  const visibleTitle = titleCharacters.length > 15
    ? `${titleCharacters.slice(0, 15).join('')}...`
    : titleLabel;

  return (
    <header
      data-conversation-header
      className="conversation-header-titlebar-inset relative z-[45] flex h-12 shrink-0 items-center justify-between gap-4 border-b border-[#e8e6e1] bg-[#fbfaf7]/96 px-3 backdrop-blur-xl transition-[padding-left] duration-200 dark:border-white/10 dark:bg-[#1f1f1f]/96"
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
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-pinned-summary-toggle
              onClick={toggleSummary}
              aria-expanded={!summaryCollapsed}
              aria-controls="conversation-pinned-summary"
              aria-label={t.panel.pinnedSummary}
              className={cn(
                iconButtonClassName,
                !summaryCollapsed && 'bg-[#ecebe7] text-[#29261b] dark:bg-white/10 dark:text-white',
              )}
            >
              <ListTodo className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            sideOffset={8}
            className="border border-white/10 bg-[#292824] px-2.5 py-1 text-[12px] font-medium text-white shadow-lg [&>svg]:hidden"
          >
            {t.panel.pinnedSummary}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-conversation-header-open-terminal
              onClick={onOpenTerminal}
              className={iconButtonClassName}
              aria-label={t.chat.openTerminal}
            >
              <Terminal className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            sideOffset={8}
            className="border border-white/10 bg-[#292824] px-2.5 py-1 text-[12px] font-medium text-white shadow-lg [&>svg]:hidden"
          >
            {t.chat.openTerminal}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
