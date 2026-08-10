import { startTransition, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Bot,
  Cpu,
  FileText,
  Folder,
  HelpCircle,
  ListTodo,
  MessageSquare,
  Plug,
  Rocket,
  Search,
  Sparkles,
  Timer,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';

import MarkdownRenderer from '@/components/chat/MarkdownRenderer';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { APP_VERSION } from '@/utils/version';
import {
  HELP_MANUAL_CHAPTERS,
  HELP_MANUAL_SECTIONS,
  localizedHelpChapter,
  localizedHelpSection,
  searchHelpManual,
  type HelpManualChapterId,
  type HelpManualLanguage,
} from './helpManualContent';

const CHAPTER_ICONS: Record<HelpManualChapterId, LucideIcon> = {
  'quick-start': Rocket,
  conversations: MessageSquare,
  'task-execution': ListTodo,
  'files-artifacts': FileText,
  'workspaces-permissions': Folder,
  'asset-research-team': Bot,
  automations: Timer,
  skills: Sparkles,
  'mcp-web': Plug,
  'models-voice': Cpu,
  'personalization-settings': UserRound,
  troubleshooting: HelpCircle,
};

export default function HelpManual({ onClose }: { onClose: () => void }) {
  const { locale } = useI18n();
  const language: HelpManualLanguage = locale === 'en-US' ? 'en' : 'zh';
  const isEnglish = language === 'en';
  const [activeId, setActiveId] = useState<HelpManualChapterId>('quick-start');
  const [query, setQuery] = useState('');
  const articleRef = useRef<HTMLDivElement>(null);
  // Cache per-chapter rendered bodies so switching back and forth never
  // re-parses markdown or re-runs syntax highlighting.
  const bodyCacheRef = useRef(new Map<string, ReactNode>());
  // Defer the first body render so the modal entrance animation plays first
  // instead of being blocked by the (heavy) markdown render.
  const [bodyReady, setBodyReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setBodyReady(true), 40);
    return () => window.clearTimeout(timer);
  }, []);

  const visibleChapters = useMemo(
    () => searchHelpManual(query, language),
    [language, query],
  );

  useEffect(() => {
    if (visibleChapters.length > 0 && !visibleChapters.some((chapter) => chapter.id === activeId)) {
      setActiveId(visibleChapters[0].id);
    }
  }, [activeId, visibleChapters]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    if (typeof article.scrollTo === 'function') article.scrollTo({ top: 0 });
    else article.scrollTop = 0;
  }, [activeId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const active = visibleChapters.find((chapter) => chapter.id === activeId);
  const activeCopy = active ? localizedHelpChapter(active, language) : null;
  const activeSection = active
    ? HELP_MANUAL_SECTIONS.find((section) => section.id === active.section)
    : null;
  const activeIndex = active
    ? visibleChapters.findIndex((chapter) => chapter.id === active.id)
    : -1;
  const previous = activeIndex > 0 ? visibleChapters[activeIndex - 1] : null;
  const next = activeIndex >= 0 && activeIndex < visibleChapters.length - 1
    ? visibleChapters[activeIndex + 1]
    : null;

  const activeBody = useMemo(() => {
    if (!active) return null;
    const key = `${active.id}:${language}`;
    const cached = bodyCacheRef.current.get(key);
    if (cached) return cached;
    const copy = localizedHelpChapter(active, language);
    const node = <MarkdownRenderer content={copy.body} />;
    bodyCacheRef.current.set(key, node);
    return node;
  }, [active, language]);

  const selectChapter = (id: HelpManualChapterId) => {
    // Keep the sidebar highlight and layout responsive while the heavy
    // markdown body renders in the background.
    startTransition(() => setActiveId(id));
  };

  return (
    <div
      data-help-manual
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 p-6 backdrop-blur-[2px] animate-in fade-in duration-150 dark:bg-black/55"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={isEnglish ? 'TPACowork User Manual' : 'TPACowork 使用手册'}
        className="flex h-[min(820px,calc(100vh-48px))] w-[min(1180px,calc(100vw-48px))] overflow-hidden rounded-[22px] border border-black/5 bg-[#fbfaf7] shadow-[0_28px_90px_rgba(0,0,0,0.24)] dark:border-white/10 dark:bg-[#232323]"
      >
        <aside className="flex w-[282px] shrink-0 flex-col border-r border-[#e6e0d7] bg-[#f5f3ee] dark:border-white/10 dark:bg-[#292929]">
          <div className="border-b border-[#e6e0d7] px-4 pb-4 pt-5 dark:border-white/10">
            <div className="flex items-center gap-3 px-1">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#d97757]/14 text-[#b96346] dark:bg-[#d97757]/20 dark:text-[#e18a68]">
                <BookOpenText className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-[#29261b] dark:text-[#f3f0e8]">
                  {isEnglish ? 'User Manual' : '使用手册'}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-[#8a867c] dark:text-[#aaa69e]">
                  {isEnglish ? 'Learn TPACowork by task' : '按任务快速找到答案'}
                </div>
              </div>
            </div>

            <label className="mt-4 flex h-9 items-center gap-2 rounded-xl border border-[#ded9d0] bg-white px-3 text-[#656358] shadow-sm focus-within:border-[#cdb9aa] focus-within:ring-2 focus-within:ring-[#d97757]/10 dark:border-[#474747] dark:bg-[#202020] dark:text-[#bbb7ae]">
              <Search className="h-4 w-4 shrink-0" />
              <input
                data-help-search
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={isEnglish ? 'Search topics or questions' : '搜索功能或问题'}
                aria-label={isEnglish ? 'Search the user manual' : '搜索使用手册'}
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[#29261b] outline-none placeholder:text-[#aaa69f] dark:text-[#f0ede7] dark:placeholder:text-[#77736c]"
                autoFocus
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="rounded p-0.5 text-[#9a968c] hover:bg-[#efede8] hover:text-[#29261b] dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label={isEnglish ? 'Clear search' : '清空搜索'}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </label>

            {query ? (
              <div className="mt-2 px-1 text-[11px] text-[#8a867c] dark:text-[#aaa69e]">
                {isEnglish
                  ? `${visibleChapters.length} matching topics`
                  : `找到 ${visibleChapters.length} 个相关主题`}
              </div>
            ) : null}
          </div>

          <nav
            data-help-navigation
            aria-label={isEnglish ? 'Manual topics' : '手册主题'}
            className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3"
          >
            {HELP_MANUAL_SECTIONS.map((section) => {
              const chapters = visibleChapters.filter((chapter) => chapter.section === section.id);
              if (chapters.length === 0) return null;
              const sectionCopy = localizedHelpSection(section, language);
              return (
                <div key={section.id} className="mb-4 last:mb-1">
                  <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a09b91] dark:text-[#77736d]">
                    {sectionCopy.label}
                  </div>
                  <div className="space-y-0.5">
                    {chapters.map((chapter) => {
                      const Icon = CHAPTER_ICONS[chapter.id];
                      const copy = localizedHelpChapter(chapter, language);
                      const isActive = chapter.id === activeId;
                      return (
                        <button
                          key={chapter.id}
                          type="button"
                          data-help-chapter={chapter.id}
                          data-active={isActive ? 'true' : 'false'}
                          onClick={() => selectChapter(chapter.id)}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors',
                            isActive
                              ? 'bg-white text-[#29261b] shadow-sm dark:bg-[#3a3a3a] dark:text-white'
                              : 'text-[#5f5a50] hover:bg-[#ece9e3] hover:text-[#29261b] dark:text-[#c4c0b7] dark:hover:bg-[#343434] dark:hover:text-white',
                          )}
                        >
                          <Icon
                            className={cn(
                              'h-4 w-4 shrink-0',
                              isActive ? 'text-[#c56c4d]' : 'text-[#8a867c] dark:text-[#918d85]',
                            )}
                            strokeWidth={1.8}
                          />
                          <span className="min-w-0 flex-1 truncate">{copy.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {visibleChapters.length === 0 ? (
              <div data-help-no-results className="px-4 py-10 text-center">
                <Search className="mx-auto h-5 w-5 text-[#aaa69e]" />
                <p className="mt-3 text-[12.5px] font-medium text-[#656358] dark:text-[#c4c0b7]">
                  {isEnglish ? 'No matching topics' : '没有找到相关主题'}
                </p>
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="mt-2 text-[12px] font-medium text-[#b96346] hover:underline dark:text-[#e18a68]"
                >
                  {isEnglish ? 'Show all topics' : '查看全部主题'}
                </button>
              </div>
            ) : null}
          </nav>

          <div className="border-t border-[#e6e0d7] px-5 py-3 text-[10.5px] text-[#9a968c] dark:border-white/10 dark:text-[#77736d]">
            {isEnglish
              ? `${HELP_MANUAL_CHAPTERS.length} task-oriented topics · v${APP_VERSION}`
              : `${HELP_MANUAL_CHAPTERS.length} 个任务主题 · v${APP_VERSION}`}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-[#202020]">
          <header className="flex min-h-[76px] shrink-0 items-start gap-3 border-b border-[#ece8e2] px-7 py-4 dark:border-white/10">
            {active ? (
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f3eee8] text-[#b96346] dark:bg-[#3a302c] dark:text-[#e18a68]">
                {(() => {
                  const Icon = CHAPTER_ICONS[active.id];
                  return <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />;
                })()}
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              {activeCopy ? (
                <>
                  <div className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-[#a09b91] dark:text-[#77736d]">
                    {activeSection ? localizedHelpSection(activeSection, language).label : ''}
                  </div>
                  <h2 data-help-title className="mt-0.5 truncate text-[17px] font-semibold tracking-[-0.01em] text-[#29261b] dark:text-[#f3f0e8]">
                    {activeCopy.title}
                  </h2>
                  <p className="mt-0.5 truncate text-[11.5px] text-[#7d796f] dark:text-[#aaa69e]">
                    {activeCopy.summary}
                  </p>
                </>
              ) : (
                <h2 className="mt-2 text-[16px] font-semibold text-[#29261b] dark:text-[#f3f0e8]">
                  {isEnglish ? 'Search the manual' : '搜索使用手册'}
                </h2>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={isEnglish ? 'Close manual' : '关闭使用手册'}
              title={isEnglish ? 'Close' : '关闭'}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[#77736b] transition-colors hover:bg-[#efede8] hover:text-[#29261b] dark:text-[#aaa69e] dark:hover:bg-white/10 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={articleRef} data-help-article className="min-h-0 flex-1 overflow-y-auto">
            {activeBody && bodyReady ? (
              <article className="mx-auto w-full max-w-[780px] px-10 pb-12 pt-7">
                {activeBody}
              </article>
            ) : (
              <div className="flex h-full items-center justify-center px-8 text-center text-[13px] text-[#77736b] dark:text-[#aaa69e]">
                {isEnglish
                  ? 'Try a feature name such as “attachments”, “MCP”, or “automation”.'
                  : '试试搜索“附件”“MCP”“自动化”或你遇到的错误。'}
              </div>
            )}
          </div>

          {activeCopy ? (
            <footer className="flex min-h-[62px] shrink-0 items-center justify-between gap-3 border-t border-[#ece8e2] px-7 py-3 dark:border-white/10">
              <button
                type="button"
                disabled={!previous}
                onClick={() => previous && selectChapter(previous.id)}
                className="group flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[#656358] transition-colors hover:bg-[#f5f3ee] hover:text-[#29261b] disabled:pointer-events-none disabled:opacity-0 dark:text-[#aaa69e] dark:hover:bg-white/10 dark:hover:text-white"
              >
                <ArrowLeft className="h-4 w-4 shrink-0" />
                <span className="max-w-[220px] truncate text-[11.5px] font-medium">
                  {previous ? localizedHelpChapter(previous, language).title : ''}
                </span>
              </button>
              <span className="shrink-0 text-[10.5px] tabular-nums text-[#aaa69e] dark:text-[#77736d]">
                {activeIndex + 1} / {visibleChapters.length}
              </span>
              <button
                type="button"
                disabled={!next}
                onClick={() => next && selectChapter(next.id)}
                className="group flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-1.5 text-right text-[#656358] transition-colors hover:bg-[#f5f3ee] hover:text-[#29261b] disabled:pointer-events-none disabled:opacity-0 dark:text-[#aaa69e] dark:hover:bg-white/10 dark:hover:text-white"
              >
                <span className="max-w-[220px] truncate text-[11.5px] font-medium">
                  {next ? localizedHelpChapter(next, language).title : ''}
                </span>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </button>
            </footer>
          ) : null}
        </div>
      </section>
    </div>
  );
}
