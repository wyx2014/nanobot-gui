import { useEffect, useRef } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Folder,
  ListTodo,
  Search,
  Terminal,
  X,
} from 'lucide-react';

import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSettingsStore } from '@/stores/settingsStore';

interface ConversationHeaderProps {
  conversationTitle: string;
  onOpenTerminal: () => void;
  searchOpen: boolean;
  searchQuery: string;
  searchMatchCount: number;
  activeSearchMatchIndex: number;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onSearchQueryChange: (query: string) => void;
  onPreviousSearchMatch: () => void;
  onNextSearchMatch: () => void;
}

const iconButtonClassName =
  'window-titlebar-no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[#77746b] transition-colors hover:bg-[#efeeeb] hover:text-[#29261b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/35 dark:text-[#aaa69e] dark:hover:bg-white/10 dark:hover:text-white';

export default function ConversationHeader({
  conversationTitle,
  onOpenTerminal,
  searchOpen,
  searchQuery,
  searchMatchCount,
  activeSearchMatchIndex,
  onOpenSearch,
  onCloseSearch,
  onSearchQueryChange,
  onPreviousSearchMatch,
  onNextSearchMatch,
}: ConversationHeaderProps) {
  const { locale, t } = useI18n();
  const summaryCollapsed = useSettingsStore((state) => state.rightPanelCollapsed);
  const toggleSummary = useSettingsStore((state) => state.toggleRightPanel);
  const isZh = locale.startsWith('zh');
  const titleLabel = conversationTitle.trim() || (isZh ? '新会话' : 'New conversation');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!searchOpen) return;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      onOpenSearch();
    };
    window.addEventListener('keydown', handleFindShortcut);
    return () => window.removeEventListener('keydown', handleFindShortcut);
  }, [onOpenSearch]);

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
          {titleLabel}
        </span>
      </div>

      <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
        {searchOpen ? (
          <div
            data-conversation-search
            role="search"
            className="window-titlebar-no-drag flex h-8 w-[clamp(15rem,24vw,20rem)] min-w-0 items-center gap-0.5 rounded-xl bg-[#efeeeb] px-1.5 text-[#55524b] shadow-[inset_0_0_0_1px_rgba(112,107,87,0.04)] dark:bg-white/10 dark:text-[#dedad2]"
          >
            <Search className="ml-0.5 h-[17px] w-[17px] shrink-0 text-[#77746b] dark:text-[#aaa69e]" strokeWidth={1.8} />
            <input
              ref={searchInputRef}
              data-conversation-search-input
              type="text"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  onCloseSearch();
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  if (event.shiftKey) onPreviousSearchMatch();
                  else onNextSearchMatch();
                }
              }}
              placeholder={t.chat.searchConversationPlaceholder}
              aria-label={t.chat.searchConversation}
              className="h-full min-w-0 flex-1 bg-transparent px-1 text-[13px] text-[#29261b] outline-none placeholder:text-[#9a978f] dark:text-[#f1eee8] dark:placeholder:text-[#8f8b83]"
            />
            {searchQuery.trim() ? (
              <span
                data-conversation-search-count
                aria-live="polite"
                className="shrink-0 px-0.5 text-[11px] tabular-nums text-[#77746b] dark:text-[#aaa69e]"
              >
                {searchMatchCount > 0 ? activeSearchMatchIndex + 1 : 0}/{searchMatchCount}
              </span>
            ) : null}
            <button
              type="button"
              data-conversation-search-previous
              onClick={onPreviousSearchMatch}
              disabled={searchMatchCount === 0}
              aria-label={t.chat.previousSearchMatch}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
            >
              <ChevronUp className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              data-conversation-search-next
              onClick={onNextSearchMatch}
              disabled={searchMatchCount === 0}
              aria-label={t.chat.nextSearchMatch}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
            >
              <ChevronDown className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              data-conversation-search-close
              onClick={onCloseSearch}
              aria-label={t.chat.closeConversationSearch}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-conversation-search-toggle
                onClick={onOpenSearch}
                aria-label={t.chat.searchConversation}
                className={iconButtonClassName}
              >
                <Search className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              sideOffset={8}
              className="border border-white/10 bg-[#292824] px-2.5 py-1 text-[12px] font-medium text-white shadow-lg [&>svg]:hidden"
            >
              {t.chat.searchConversation}
            </TooltipContent>
          </Tooltip>
        )}

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
