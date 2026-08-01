import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleMinus,
  ClipboardList,
  FilePenLine,
  Globe2,
  Image,
  Info,
  Loader2,
  Monitor,
  Plug,
  Search,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@/types';
import type { TaskProgressStep } from '@/core/types';
import {
  buildTaskNarrativeEntries,
  type TaskNarrativeEntry,
  type TaskNarrativeStatus,
} from '@/core/nanobot/taskNarrativeTimeline';
import { formatTaskDuration } from '@/utils/taskDuration';
import MarkdownRenderer from './MarkdownRenderer';

interface TaskNarrativeTimelineProps {
  messages: Message[];
  isActive?: boolean;
  hasBodyBelow?: boolean;
  turnLatencyMs?: number;
  activeElapsedMs?: number;
}

type HopeUnitKind = 'thinking' | 'tool' | 'tool-group' | 'plan' | 'loading';
type HopeTimelineTone = 'failed' | 'running' | 'thinking' | 'tool';
type HopeMarkerAlign = 'control' | 'text';

interface HopeUnit {
  key: string;
  kind: HopeUnitKind;
  entries: TaskNarrativeEntry[];
  status: TaskNarrativeStatus;
  tone: HopeTimelineTone;
  markerAlign: HopeMarkerAlign;
  label?: string;
}

interface HopeRenderItem {
  key: string;
  units: HopeUnit[];
  processed: boolean;
  active: boolean;
  tone: HopeTimelineTone;
  markerAlign: HopeMarkerAlign;
  failedCount: number;
  elapsedMs?: number;
}

/**
 * Hope Agent-compatible process renderer.
 *
 * There is deliberately no outer "ToolStep card", step counter, internal
 * scrolling pane, or per-row activity ripple. Thinking and tools are rendered
 * as ordered message blocks. Only the last live block receives the timeline
 * activity marker, and a completed run folds only after assistant text begins.
 */
export default function TaskNarrativeTimeline({
  messages,
  isActive = false,
  hasBodyBelow = false,
  turnLatencyMs,
  activeElapsedMs,
}: TaskNarrativeTimelineProps) {
  const entries = useMemo(
    () => removeEmptyThinkingBeforeNarration(buildTaskNarrativeEntries(messages)),
    [messages],
  );
  const baseUnits = useMemo(() => buildHopeUnits(entries), [entries]);
  const activityActive = isActive && !hasBodyBelow;
  const [, refreshClock] = useState(0);

  useEffect(() => {
    if (!activityActive || activeElapsedMs !== undefined) return;
    const timer = window.setInterval(() => refreshClock((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, [activeElapsedMs, activityActive]);

  const units = appendHopeLoadingUnit(baseUnits, activityActive);
  const activeUnitKey = activityActive ? units.at(-1)?.key : undefined;
  const liveThinkingUnitKey = activityActive
    ? [...units].reverse().find(
      (unit) => unit.kind === 'thinking' && unit.status === 'running',
    )?.key
    : undefined;
  const items = buildHopeRenderItems(
    units,
    hasBodyBelow,
    activeUnitKey,
    turnLatencyMs,
    activeElapsedMs,
  );

  if (items.length === 0) return null;

  return (
    <section
      data-hope-toolstep
      data-active={activityActive ? 'true' : 'false'}
      className="w-full py-0.5"
      aria-label="任务执行过程"
      aria-live={activityActive ? 'polite' : 'off'}
    >
      <HopeMessageTimeline>
        {items.map((item) => (
          <HopeMessageTimelineItem
            key={item.key}
            active={item.active}
            markerAlign={item.markerAlign}
            tone={item.tone}
          >
            {item.processed ? (
              <HopeProcessedBlockGroup
                units={item.units}
                failedCount={item.failedCount}
                elapsedMs={item.elapsedMs}
              />
            ) : (
              <HopeUnitContent
                unit={item.units[0]}
                active={item.active || item.key === liveThinkingUnitKey}
                elapsedMs={item.elapsedMs}
              />
            )}
          </HopeMessageTimelineItem>
        ))}
      </HopeMessageTimeline>
    </section>
  );
}

function HopeMessageTimeline({ children }: { children: ReactNode }) {
  return (
    <div
      data-hope-message-timeline
      className="relative grid w-full max-w-4xl grid-cols-[1rem_minmax(0,1fr)] gap-x-3"
    >
      {children}
    </div>
  );
}

function HopeMessageTimelineItem({
  children,
  active,
  markerAlign,
  tone,
}: {
  children: ReactNode;
  active: boolean;
  markerAlign: HopeMarkerAlign;
  tone: HopeTimelineTone;
}) {
  const markerOffset = markerAlign === 'control' ? 'pt-[0.625rem]' : 'pt-[0.375rem]';
  const lineStart = markerAlign === 'control' ? 'top-[1.225rem]' : 'top-[0.975rem]';

  return (
    <div
      data-hope-timeline-item
      data-active={active ? 'true' : 'false'}
      data-tone={tone}
      className="group/hope-timeline relative col-span-2 grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-x-3 py-0.5"
    >
      <div className={cn('relative flex justify-center', markerOffset)}>
        <span
          data-hope-timeline-line
          aria-hidden
          className={cn(
            'pointer-events-none absolute bottom-0 left-1/2 w-px -translate-x-1/2 bg-sky-500/18 dark:bg-sky-300/12 group-last/hope-timeline:hidden',
            lineStart,
          )}
        />
        <span className="relative flex h-2.5 w-2.5 items-center justify-center">
          {active ? (
            <>
              <span
                data-hope-ripple
                className={cn(
                  'absolute h-4 w-4 rounded-full opacity-70 motion-safe:animate-ping [animation-duration:1.6s]',
                  hopeRippleClass(tone),
                )}
              />
              <span
                data-hope-ripple
                className={cn(
                  'absolute h-5 w-5 rounded-full opacity-40 motion-safe:animate-ping [animation-delay:450ms] [animation-duration:1.8s]',
                  hopeRippleClass(tone),
                )}
              />
            </>
          ) : null}
          <span
            data-hope-timeline-dot
            className={cn(
              'relative z-10 h-2.5 w-2.5 rounded-full ring-[3px] ring-background',
              active && 'motion-safe:animate-pulse',
              hopeDotClass(tone),
            )}
          />
        </span>
      </div>
      <div className="min-w-0 break-words pb-0.5 text-[12px] leading-[1.6] text-foreground">
        {children}
      </div>
    </div>
  );
}

function HopeUnitContent({
  unit,
  active,
  elapsedMs,
}: {
  unit: HopeUnit;
  active: boolean;
  elapsedMs?: number;
}) {
  if (unit.kind === 'loading') return <HopeLoadingDots />;
  if (unit.kind === 'thinking') {
    return <HopeThinkingBlock entry={unit.entries[0]} active={active} elapsedMs={elapsedMs} />;
  }
  if (unit.kind === 'tool-group') {
    return (
      <HopeToolCallGroup
        entries={unit.entries}
        active={active}
        elapsedMs={elapsedMs}
        label={unit.label}
      />
    );
  }
  if (unit.kind === 'plan') {
    return <HopePlanBlock entry={unit.entries[0]} active={active} elapsedMs={elapsedMs} />;
  }
  return <HopeToolCallBlock entry={unit.entries[0]} active={active} elapsedMs={elapsedMs} />;
}

function HopeThinkingBlock({
  entry,
  active,
  elapsedMs,
}: {
  entry: TaskNarrativeEntry;
  active: boolean;
  elapsedMs?: number;
}) {
  const content = entry.content?.trim() || '';
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canExpand = content.length > 0;
  const open = canExpand && (manualOpen ?? active);

  useEffect(() => {
    if (!open) return;
    const container = contentRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [content, open]);

  return (
    <div data-hope-thinking data-entry-id={entry.id} className="mb-1">
      <button
        type="button"
        disabled={!canExpand}
        aria-expanded={canExpand ? open : undefined}
        onClick={() => canExpand && setManualOpen((previous) => !(previous ?? active))}
        className={cn(
          'group flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground',
          !canExpand && 'cursor-default',
        )}
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 transition-transform duration-200',
            open && 'rotate-90',
            !canExpand && 'opacity-40',
          )}
        />
        <BrainCircuit
          className={cn(
            'h-3.5 w-3.5',
            active && 'text-purple-400 motion-safe:animate-pulse',
          )}
        />
        <span data-hope-thinking-label className={cn(active && 'hope-text-shimmer')}>
          {active ? '正在思考' : '已思考'}
        </span>
        {elapsedMs !== undefined && elapsedMs > 0 ? (
          <span className="text-[10px] tabular-nums text-muted-foreground/70">
            耗时 {formatTaskDuration(elapsedMs)}
          </span>
        ) : null}
        {active ? (
          <span className="text-[10px] text-purple-400 motion-safe:animate-pulse">···</span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={contentRef}
          data-hope-thinking-content
          className="ml-1 max-h-[320px] overflow-y-auto border-l-2 border-purple-400/25 pl-3 pr-2 text-[12px] font-normal leading-[1.65] text-muted-foreground/65 motion-safe:animate-in motion-safe:fade-in-0"
        >
          <div className="hope-thinking-markdown min-w-0 break-words py-0.5">
            <MarkdownRenderer content={content} variant="activity" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HopeToolCallBlock({
  entry,
  active,
  elapsedMs,
  compact = false,
  groupMember = false,
}: {
  entry: TaskNarrativeEntry;
  active: boolean;
  elapsedMs?: number;
  compact?: boolean;
  groupMember?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const hasDetails = hasExpandableDetails(entry);
  const canExpand = hasDetails && (entry.status !== 'running' || entry.source === 'shell');
  const failed = entry.status === 'error';
  const Icon = entryIcon(entry);
  const target = toolTarget(entry);

  return (
    <div
      data-hope-tool
      data-entry-id={entry.id}
      data-status={entry.status}
      data-group-member={groupMember ? 'true' : 'false'}
      className={cn(compact ? 'text-[11px]' : 'my-1 text-xs')}
    >
      <div className="group/hope-tool flex min-w-0 items-center rounded-md transition-colors hover:bg-secondary/60">
        <button
          type="button"
          disabled={!canExpand}
          aria-expanded={canExpand ? expanded : undefined}
          onClick={() => canExpand && setExpanded((value) => !value)}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-left',
            compact ? 'pl-1.5 py-0.5' : 'pl-0',
            !canExpand && 'cursor-default',
          )}
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200',
              compact && 'h-3 w-3',
              expanded && 'rotate-90',
              !canExpand && 'opacity-40',
            )}
          />
          <span className={cn('relative h-3.5 w-3.5 shrink-0', compact && 'h-3 w-3')}>
            <Icon className={cn('h-3.5 w-3.5 text-muted-foreground', compact && 'h-3 w-3')} />
            {active ? (
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/60 ring-1 ring-card motion-safe:animate-pulse" />
            ) : null}
          </span>
          <span
            data-hope-tool-label
            className={cn(
              'shrink-0 whitespace-nowrap font-medium text-muted-foreground',
              failed && 'text-red-500',
              active && 'hope-text-shimmer',
            )}
          >
            {entry.title}
          </span>
          {target ? (
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/60" title={target}>
              {target}
            </span>
          ) : null}
          {groupMember ? (
            <span
              data-hope-group-member-status
              className={cn(
                'ml-auto shrink-0 text-[10px] font-normal',
                entry.status === 'running' && 'text-blue-500/80',
                entry.status === 'done' && 'text-teal-600/75 dark:text-teal-400/70',
                entry.status === 'error' && 'text-red-500/85',
                entry.status === 'pending' && 'text-muted-foreground/55',
              )}
            >
              {groupMemberStatusLabel(entry.status)}
            </span>
          ) : null}
          {elapsedMs !== undefined && elapsedMs > 0 ? (
            <span className={cn(
              'shrink-0 text-[10px] tabular-nums text-muted-foreground/60',
              !groupMember && 'ml-auto',
            )}>
              耗时 {formatTaskDuration(elapsedMs)}
            </span>
          ) : null}
        </button>
        {hasDetails ? (
          <button
            type="button"
            data-hope-raw-toggle
            aria-label="查看原始调用"
            aria-expanded={showRaw}
            onClick={() => setShowRaw((value) => !value)}
            className="mr-1 shrink-0 rounded p-0.5 text-muted-foreground/40 opacity-0 transition-all hover:bg-secondary hover:text-muted-foreground/80 focus-visible:opacity-100 group-hover/hope-tool:opacity-100"
          >
            <Info className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      {showRaw ? (
        <div className={cn('mt-0.5 mb-1', compact ? 'ml-4' : 'ml-5')}>
          <pre className="max-h-64 select-all overflow-y-auto whitespace-pre-wrap rounded-md border border-border/30 bg-muted/50 p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground/70 motion-safe:animate-in motion-safe:fade-in-0">
            {formatRawEntry(entry)}
          </pre>
        </div>
      ) : null}

      {expanded ? (
        <div className={cn('mt-0.5 mb-1', compact ? 'ml-4' : 'ml-5')}>
          <HopeEntryResult entry={entry} />
        </div>
      ) : null}
    </div>
  );
}

function HopeToolCallGroup({
  entries,
  active,
  elapsedMs,
  label,
}: {
  entries: TaskNarrativeEntry[];
  active: boolean;
  elapsedMs?: number;
  label?: string;
}) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const expanded = manualExpanded ?? active;
  const status = aggregateStatus(entries);
  const failedCount = countFailedEntries(entries);
  const Icon = groupIcon(entries);
  const displayLabel = label
    ? labelledToolGroupTitle(label, entries.length, active)
    : toolGroupLabel(entries, active);

  return (
    <div
      data-hope-tool-group
      data-entry-ids={entries.map((entry) => entry.id).join(',')}
      className="my-1 text-xs"
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded((previous) => !(previous ?? active))}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 pl-0 pr-1 text-left transition-colors hover:bg-secondary/60"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        )}
        <span className="relative h-3.5 w-3.5 shrink-0">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {active ? (
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/60 ring-1 ring-card motion-safe:animate-pulse" />
          ) : null}
        </span>
        <span
          data-hope-tool-group-label
          className={cn(
            'min-w-0 font-medium text-muted-foreground',
            active && 'hope-text-shimmer',
            status === 'error' && 'text-red-500',
          )}
        >
          {displayLabel}
        </span>
        {failedCount > 0 ? (
          <span className="shrink-0 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-500">
            <span className="inline-flex items-center gap-0.5">
              <AlertCircle className="h-3 w-3" />
              {failedCount} 项失败
            </span>
          </span>
        ) : null}
        {elapsedMs !== undefined && elapsedMs > 0 ? (
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
            耗时 {formatTaskDuration(elapsedMs)}
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div
          data-hope-tool-group-members
          className="ml-3 border-l border-border/40 pl-0.5 motion-safe:animate-in motion-safe:fade-in-0"
        >
          {entries.map((entry) => (
            <HopeToolCallBlock
              key={entry.id}
              entry={entry}
              active={false}
              compact
              groupMember
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HopePlanBlock({
  entry,
  active,
  elapsedMs,
}: {
  entry: TaskNarrativeEntry;
  active: boolean;
  elapsedMs?: number;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const steps = entry.planSteps ?? [];
  const open = manualOpen ?? active;

  return (
    <div data-hope-plan data-entry-id={entry.id} className="my-1 text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setManualOpen((previous) => !(previous ?? active))}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 pl-0 pr-1 text-left transition-colors hover:bg-secondary/60"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200',
            open && 'rotate-90',
          )}
        />
        <ClipboardList className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className={cn('font-medium text-muted-foreground', active && 'hope-text-shimmer')}>
          {entry.title}
        </span>
        {entry.detail ? (
          <span className="min-w-0 truncate text-muted-foreground/60">{entry.detail}</span>
        ) : null}
        {elapsedMs !== undefined && elapsedMs > 0 ? (
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
            耗时 {formatTaskDuration(elapsedMs)}
          </span>
        ) : null}
      </button>

      {open && steps.length > 0 ? (
        <div className="ml-3 border-l border-border/40 pl-2 motion-safe:animate-in motion-safe:fade-in-0">
          <ol className="space-y-1 py-1">
            {steps.map((step) => {
              const Icon = planStepIcon(step.status);
              return (
                <li key={step.id} className="flex min-w-0 items-center gap-1.5 text-[11px] leading-5">
                  <Icon
                    className={cn(
                      'h-3 w-3 shrink-0 text-muted-foreground/50',
                      step.status === 'running' && 'text-blue-500 motion-safe:animate-spin',
                      step.status === 'completed' && 'text-teal-500',
                      step.status === 'error' && 'text-red-500',
                    )}
                  />
                  <span
                    className={cn(
                      'min-w-0 truncate text-muted-foreground/70',
                      step.status === 'running' && 'font-medium text-muted-foreground',
                    )}
                  >
                    {step.title}
                    {step.detail ? ` · ${step.detail}` : ''}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function HopeProcessedBlockGroup({
  units,
  failedCount,
  elapsedMs,
}: {
  units: HopeUnit[];
  failedCount: number;
  elapsedMs?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div data-hope-processed className="my-1 text-xs">
      <button
        type="button"
        aria-label={expanded ? '折叠已处理步骤' : '展开已处理步骤'}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pl-0 pr-1 text-left transition-colors hover:bg-secondary/60"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-200',
            expanded && 'rotate-90',
          )}
        />
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/75" />
        <span className="font-medium text-muted-foreground/75">已处理</span>
        {elapsedMs !== undefined && elapsedMs > 0 ? (
          <span className="shrink-0 font-medium tabular-nums text-muted-foreground/75">
            {formatTaskDuration(elapsedMs)}
          </span>
        ) : null}
        {failedCount > 0 ? (
          <span className="shrink-0 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-500">
            <span className="inline-flex items-center gap-0.5">
              <AlertCircle className="h-3 w-3" />
              {failedCount} 项失败
            </span>
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="ml-3 border-l border-border/40 pl-2 motion-safe:animate-in motion-safe:fade-in-0">
          {units.map((unit) => (
            <HopeUnitContent
              key={unit.key}
              unit={unit}
              active={false}
              elapsedMs={unitElapsedMs(unit, Date.now())}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HopeEntryResult({ entry }: { entry: TaskNarrativeEntry }) {
  return (
    <div className="rounded-md border border-border/50 bg-secondary/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground/80 motion-safe:animate-in motion-safe:fade-in-0">
      {entry.error ? <TechnicalBlock label="错误" content={entry.error} error /> : null}
      {!entry.error && entry.result ? <TechnicalBlock label="结果" content={entry.result} /> : null}
      {!entry.error && !entry.result && entry.input ? (
        <TechnicalBlock label="输入" content={formatUnknown(entry.input)} />
      ) : null}
    </div>
  );
}

function HopeLoadingDots() {
  return (
    <div data-hope-loading className="flex items-center gap-1 px-2 py-1">
      <span className="block h-1.5 w-1.5 rounded-full bg-foreground/50 motion-safe:animate-pulse" />
      <span className="block h-1.5 w-1.5 rounded-full bg-foreground/50 motion-safe:animate-pulse [animation-delay:300ms]" />
      <span className="block h-1.5 w-1.5 rounded-full bg-foreground/50 motion-safe:animate-pulse [animation-delay:600ms]" />
    </div>
  );
}

function TechnicalBlock({
  label,
  content,
  error = false,
}: {
  label: string;
  content: string;
  error?: boolean;
}) {
  return (
    <div className="mt-2 first:mt-0">
      <div className={cn('mb-1 text-[10px] font-medium text-muted-foreground/60', error && 'text-red-500')}>
        {label}
      </div>
      <pre className={cn(
        'max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground/80',
        error && 'text-red-500',
      )}>
        {content}
      </pre>
    </div>
  );
}

function buildHopeUnits(entries: TaskNarrativeEntry[]): HopeUnit[] {
  const units: HopeUnit[] = [];
  let index = 0;

  while (index < entries.length) {
    const entry = entries[index];

    if (entry.kind === 'analysis' || entry.kind === 'narration') {
      units.push({
        key: `thinking:${entry.id}`,
        kind: 'thinking',
        entries: [entry],
        status: entry.status,
        tone: entry.status === 'error' ? 'failed' : entry.status === 'running' ? 'running' : 'thinking',
        markerAlign: 'text',
      });
      index += 1;
      continue;
    }

    if (entry.kind === 'plan') {
      units.push({
        key: `plan:${entry.id}`,
        kind: 'plan',
        entries: [entry],
        status: entry.status,
        tone: toneForStatus(entry.status, 'tool'),
        markerAlign: 'control',
      });
      index += 1;
      continue;
    }

    if (entry.kind === 'batch') {
      const children = entry.childEntries?.length ? entry.childEntries : [entry];
      units.push({
        key: `group:${entry.id}`,
        kind: 'tool-group',
        entries: children,
        status: aggregateStatus(children),
        tone: toneForStatus(aggregateStatus(children), 'tool'),
        markerAlign: 'control',
        label: entry.title,
      });
      index += 1;
      continue;
    }

    if (entry.kind === 'tool') {
      const tools = [entry];
      let next = index + 1;
      while (next < entries.length && entries[next].kind === 'tool') {
        tools.push(entries[next]);
        next += 1;
      }
      const status = aggregateStatus(tools);
      units.push({
        key: tools.length >= 2 ? `group:${tools[0].id}` : `tool:${tools[0].id}`,
        kind: tools.length >= 2 ? 'tool-group' : 'tool',
        entries: tools,
        status,
        tone: toneForStatus(status, 'tool'),
        markerAlign: 'control',
      });
      index = next;
      continue;
    }

    units.push({
      key: `tool:${entry.id}`,
      kind: 'tool',
      entries: [entry],
      status: entry.status,
      tone: toneForStatus(entry.status, 'tool'),
      markerAlign: 'control',
    });
    index += 1;
  }

  return units;
}

function appendHopeLoadingUnit(units: HopeUnit[], active: boolean): HopeUnit[] {
  if (!active) return units;
  const last = units.at(-1);
  if (!last) {
    return [{
      key: '__loading__',
      kind: 'loading',
      entries: [],
      status: 'running',
      tone: 'running',
      markerAlign: 'text',
    }];
  }
  if (last.status !== 'running' && last.status !== 'pending') {
    return [...units, {
      key: '__loading__',
      kind: 'loading',
      entries: [],
      status: 'running',
      tone: 'running',
      markerAlign: 'text',
    }];
  }
  return units;
}

function buildHopeRenderItems(
  units: HopeUnit[],
  hasBodyBelow: boolean,
  activeUnitKey: string | undefined,
  turnLatencyMs: number | undefined,
  activeElapsedMs: number | undefined,
): HopeRenderItem[] {
  const items: HopeRenderItem[] = [];
  let index = 0;

  while (index < units.length) {
    const unit = units[index];
    if (!hasBodyBelow || !isCompletedProcessUnit(unit)) {
      items.push(singleRenderItem(unit, activeUnitKey, activeElapsedMs));
      index += 1;
      continue;
    }

    const run = [unit];
    let next = index + 1;
    while (next < units.length && isCompletedProcessUnit(units[next])) {
      run.push(units[next]);
      next += 1;
    }

    if (run.length < 2 && unit.kind !== 'plan') {
      items.push(singleRenderItem(unit, activeUnitKey, activeElapsedMs));
      index = next;
      continue;
    }

    const allProcessUnits = units.filter((candidate) => candidate.kind !== 'loading');
    const coversWholeRun = run.length === allProcessUnits.length;
    const fallbackElapsed = sumUnitDurations(run);
    items.push({
      key: `processed:${run[0].key}`,
      units: run,
      processed: true,
      active: false,
      tone: countFailedUnits(run) > 0
        ? 'failed'
        : run.every((candidate) => candidate.kind === 'thinking')
          ? 'thinking'
          : 'tool',
      markerAlign: 'control',
      failedCount: countFailedUnits(run),
      elapsedMs: coversWholeRun && validDuration(turnLatencyMs)
        ? turnLatencyMs
        : fallbackElapsed > 0 ? fallbackElapsed : undefined,
    });
    index = next;
  }

  return items;
}

function singleRenderItem(
  unit: HopeUnit,
  activeUnitKey: string | undefined,
  activeElapsedMs: number | undefined,
): HopeRenderItem {
  const active = unit.key === activeUnitKey;
  return {
    key: unit.key,
    units: [unit],
    processed: false,
    active,
    tone: active ? activeTone(unit) : unit.tone,
    markerAlign: unit.markerAlign,
    failedCount: countFailedEntries(unit.entries),
    elapsedMs: unitElapsedMs(unit, Date.now(), active ? activeElapsedMs : undefined),
  };
}

function removeEmptyThinkingBeforeNarration(entries: TaskNarrativeEntry[]): TaskNarrativeEntry[] {
  return entries.filter((entry, index) => (
    entry.kind !== 'analysis'
    || !!entry.content?.trim()
    || entries[index + 1]?.kind !== 'narration'
  ));
}

function isCompletedProcessUnit(unit: HopeUnit): boolean {
  return unit.kind !== 'loading' && (unit.status === 'done' || unit.status === 'error');
}

function activeTone(unit: HopeUnit): HopeTimelineTone {
  return unit.kind === 'thinking' ? 'thinking' : 'running';
}

function toneForStatus(
  status: TaskNarrativeStatus,
  completedTone: HopeTimelineTone,
): HopeTimelineTone {
  if (status === 'error') return 'failed';
  if (status === 'running' || status === 'pending') return 'running';
  return completedTone;
}

function aggregateStatus(entries: TaskNarrativeEntry[]): TaskNarrativeStatus {
  if (entries.some((entry) => entry.status === 'running')) return 'running';
  if (entries.some((entry) => entry.status === 'pending')) return 'pending';
  if (entries.some((entry) => entry.status === 'error')) return 'error';
  return 'done';
}

function countFailedEntries(entries: TaskNarrativeEntry[]): number {
  return entries.reduce((count, entry) => (
    count
    + (entry.status === 'error' ? 1 : 0)
    + (entry.childEntries ? countFailedEntries(entry.childEntries) : 0)
  ), 0);
}

function countFailedUnits(units: HopeUnit[]): number {
  return units.reduce((count, unit) => count + countFailedEntries(unit.entries), 0);
}

function unitElapsedMs(
  unit: HopeUnit,
  now: number,
  activeElapsedMs?: number,
): number | undefined {
  const explicit = unit.entries
    .map((entry) => entry.durationMs)
    .filter((value): value is number => validDuration(value));
  if (explicit.length > 0) return Math.max(...explicit);

  const starts = unit.entries
    .map((entry) => normalizedTimestamp(entry.startedAt ?? entry.occurredAt))
    .filter((value): value is number => value !== undefined);
  const ends = unit.entries
    .map((entry) => normalizedTimestamp(entry.completedAt))
    .filter((value): value is number => value !== undefined);
  if (starts.length > 0) {
    const start = Math.min(...starts);
    const end = ends.length > 0 ? Math.max(...ends) : unit.status === 'running' ? now : start;
    const duration = Math.max(0, end - start);
    if (duration > 0) return duration;
  }
  return unit.status === 'running' && validDuration(activeElapsedMs)
    ? activeElapsedMs
    : undefined;
}

function sumUnitDurations(units: HopeUnit[]): number {
  return units.reduce((sum, unit) => sum + (unitElapsedMs(unit, Date.now()) ?? 0), 0);
}

function normalizedTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value >= 1_000_000_000_000) return value;
  if (value >= 1_000_000_000) return value * 1000;
  return undefined;
}

function validDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function toolTarget(entry: TaskNarrativeEntry): string | undefined {
  const input = entry.input;
  if (input) {
    for (const key of [
      'command',
      'query',
      'url',
      'path',
      'file_path',
      'target',
      'subject',
      'prompt',
      'name',
    ]) {
      const value = input[key];
      if (typeof value === 'string' && value.trim()) return compactText(value);
    }
  }
  return entry.detail ? compactText(entry.detail) : undefined;
}

function compactText(value: string, maxLength = 120): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function toolGroupLabel(entries: TaskNarrativeEntry[], active: boolean): string {
  if (active) return `正在执行 ${entries.length} 项操作`;
  const sourceCounts = new Map<string, number>();
  entries.forEach((entry) => {
    const key = entry.source;
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
  });
  return [...sourceCounts.entries()].map(([source, count]) => {
    if (source === 'web' || source === 'browser') return `已搜索网页 ${count} 次`;
    if (source === 'shell') return `已运行命令 ${count} 次`;
    if (source === 'file') return `已处理文件 ${count} 次`;
    if (source === 'mcp') return `已调用连接器 ${count} 次`;
    if (source === 'media') return `已生成内容 ${count} 次`;
    return `工具调用 ${count} 次`;
  }).join(' · ');
}

function labelledToolGroupTitle(label: string, count: number, active: boolean): string {
  if (label === '并行执行') {
    return active ? `并行执行 · ${count} 项` : `已并行完成 ${count} 项`;
  }
  return active ? `${label} · ${count} 项` : `${label} · 已完成 ${count} 项`;
}

function groupMemberStatusLabel(status: TaskNarrativeStatus): string {
  if (status === 'running') return '进行中';
  if (status === 'done') return '完成';
  if (status === 'error') return '失败';
  return '等待';
}

function groupIcon(entries: TaskNarrativeEntry[]): LucideIcon {
  if (entries.some((entry) => entry.source === 'web' || entry.source === 'browser')) return Globe2;
  if (entries.some((entry) => entry.source === 'shell')) return Terminal;
  if (entries.some((entry) => entry.source === 'file')) return FilePenLine;
  if (entries.some((entry) => entry.source === 'mcp')) return Plug;
  if (entries.some((entry) => entry.source === 'media')) return Image;
  return Wrench;
}

function entryIcon(entry: TaskNarrativeEntry): LucideIcon {
  if (entry.status === 'error') return AlertCircle;
  if (entry.source === 'web') return Search;
  if (entry.source === 'browser') return Monitor;
  if (entry.source === 'shell') return Terminal;
  if (entry.source === 'mcp') return Plug;
  if (entry.source === 'file') return FilePenLine;
  if (entry.source === 'media') return Image;
  return Wrench;
}

function planStepIcon(status: TaskProgressStep['status']): LucideIcon {
  if (status === 'completed') return CheckCircle2;
  if (status === 'running') return Loader2;
  if (status === 'error') return AlertCircle;
  if (status === 'skipped' || status === 'interrupted') return CircleMinus;
  return Circle;
}

function hasExpandableDetails(entry: TaskNarrativeEntry): boolean {
  if (entry.artifactOutput) return false;
  return !!(
    entry.error
    || entry.result
    || (entry.input && Object.keys(entry.input).length > 0)
  );
}

function formatRawEntry(entry: TaskNarrativeEntry): string {
  const payload = {
    action: entry.title,
    input: entry.input,
    result: entry.result,
    error: entry.error,
  };
  return formatUnknown(payload);
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function hopeDotClass(tone: HopeTimelineTone): string {
  if (tone === 'failed') return 'bg-red-500';
  if (tone === 'running') return 'bg-blue-500';
  if (tone === 'thinking') return 'bg-violet-500';
  return 'bg-teal-500';
}

function hopeRippleClass(tone: HopeTimelineTone): string {
  if (tone === 'failed') return 'bg-red-400';
  if (tone === 'running') return 'bg-blue-400';
  if (tone === 'thinking') return 'bg-violet-400';
  return 'bg-teal-400';
}
