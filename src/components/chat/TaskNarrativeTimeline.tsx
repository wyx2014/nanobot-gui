import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  BookOpenText,
  Brain,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDashed,
  ClipboardList,
  FilePenLine,
  Globe2,
  Image,
  Layers3,
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
} from '@/core/nanobot/taskNarrativeTimeline';
import { getBaseName } from '@/utils/pathUtils';
import { ActivityEvidencePreview } from './activity/ActivityEvidencePreview';
import { DiffPair } from './activity/DiffPair';

interface TaskNarrativeTimelineProps {
  messages: Message[];
  isActive?: boolean;
  hasBodyBelow?: boolean;
}

export default function TaskNarrativeTimeline({
  messages,
  isActive = false,
  hasBodyBelow = false,
}: TaskNarrativeTimelineProps) {
  const entries = useMemo(() => buildTaskNarrativeEntries(messages), [messages]);
  const showContinuation = isActive
    && entries.length > 0
    && !hasBodyBelow
    && !entries.some((entry) => entry.status === 'running');

  if (entries.length === 0 && !isActive) return null;

  return (
    <section
      className={cn(
        'w-full py-0.5 text-[#656358] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200',
        hasBodyBelow && 'mb-0.5',
      )}
      aria-label="任务执行过程"
      aria-live={isActive ? 'polite' : 'off'}
    >
      <ol className="space-y-2.5">
        {entries.map((entry) => (
          <NarrativeActionRow key={entry.id} entry={entry} />
        ))}
        {showContinuation ? (
          <NarrativeActionRow
            entry={{
              id: 'active-continuation',
              kind: 'analysis',
              title: '继续处理',
              detail: '正在整理下一步',
              status: 'running',
              source: 'reasoning',
            }}
          />
        ) : null}
        {entries.length === 0 && isActive ? (
          <NarrativeActionRow
            entry={{
              id: 'active-placeholder',
              kind: 'analysis',
              title: '整理思路',
              detail: '正在分析任务',
              status: 'running',
              source: 'reasoning',
            }}
          />
        ) : null}
      </ol>
    </section>
  );
}

function NarrativeActionRow({ entry }: { entry: TaskNarrativeEntry }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = entryIcon(entry);
  const hasDetails = hasExpandableDetails(entry);
  const fileDetail = entry.kind === 'file' && entry.detail
    ? getBaseName(entry.detail) || entry.detail
    : entry.detail;

  return (
    <li className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-2.5">
      <span
        className={cn(
          'mt-[3px] grid h-4 w-4 place-items-center text-[#8b887c] transition-colors',
          entry.status === 'running' && 'text-[#8b887c] motion-safe:animate-pulse',
          entry.status === 'error' && 'text-red-500',
        )}
        aria-hidden
      >
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </span>

      <div className="min-w-0">
        <button
          type="button"
          disabled={!hasDetails}
          onClick={() => hasDetails && setExpanded((value) => !value)}
          className={cn(
            'group flex min-h-5 w-full min-w-0 items-baseline gap-x-2 text-left text-[13.5px] leading-5',
            hasDetails && 'cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/20',
            !hasDetails && 'cursor-default',
          )}
          aria-expanded={hasDetails ? expanded : undefined}
        >
          <span
            className={cn(
              'shrink-0 font-medium text-[#77746b]',
              entry.status === 'running' && 'streaming-text-sheen',
              entry.status === 'error' && 'text-red-600',
            )}
          >
            {entry.title}
          </span>
          {fileDetail ? (
            <span
              className={cn(
                'min-w-0 truncate text-[#8b887c]',
                entry.status === 'running' && 'streaming-text-sheen',
                entry.status === 'error' && 'text-red-500/90',
                entry.kind === 'file' && 'font-medium text-[#77746b]',
              )}
              title={entry.detail}
            >
              {entry.kind === 'file' ? null : '· '}
              {fileDetail}
            </span>
          ) : null}
          {entry.kind === 'file' && entry.fileEdit && hasDiff(entry.fileEdit) ? (
            <span className="ml-auto shrink-0">
              <DiffPair added={entry.fileEdit.added} deleted={entry.fileEdit.deleted} />
            </span>
          ) : null}
          {hasDetails ? (
            <ChevronDown
              className={cn(
                'ml-auto h-3.5 w-3.5 shrink-0 text-[#aaa69b] opacity-0 transition-all group-hover:opacity-100',
                expanded && 'rotate-180 opacity-100',
              )}
              aria-hidden
            />
          ) : null}
        </button>

        {entry.evidence?.length ? (
          <ActivityEvidencePreview evidence={entry.evidence} className="mt-1.5" />
        ) : null}

        {expanded ? <EntryDetails entry={entry} /> : null}
      </div>
    </li>
  );
}

function EntryDetails({ entry }: { entry: TaskNarrativeEntry }) {
  if (entry.kind === 'batch' && entry.childEntries?.length) {
    return <BatchEntries entries={entry.childEntries} />;
  }

  if (entry.kind === 'plan' && entry.planSteps?.length) {
    return <PlanSteps steps={entry.planSteps} />;
  }

  if (entry.kind === 'file' && entry.fileEdit) {
    return (
      <DetailPanel>
        <DetailLine label="文件" value={entry.fileEdit.absolute_path || entry.fileEdit.path} />
        {entry.error ? <DetailLine label="错误" value={entry.error} error /> : null}
      </DetailPanel>
    );
  }

  return (
    <DetailPanel>
      {entry.input && Object.keys(entry.input).length > 0 ? (
        <TechnicalBlock label="输入" content={formatUnknown(entry.input)} />
      ) : null}
      {entry.error ? <TechnicalBlock label="错误" content={entry.error} error /> : null}
      {!entry.error && entry.result ? <TechnicalBlock label="结果" content={entry.result} /> : null}
    </DetailPanel>
  );
}

function BatchEntries({ entries }: { entries: TaskNarrativeEntry[] }) {
  return (
    <div className="mt-2 max-w-[46rem] border-l border-[#dedad1] pl-3">
      <ol className="space-y-2">
        {entries.map((entry) => (
          <NarrativeActionRow key={entry.id} entry={entry} />
        ))}
      </ol>
    </div>
  );
}

function DetailPanel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 max-w-[46rem] overflow-hidden rounded-lg border border-[#e8e4dd] bg-white/75 px-3 py-2.5 text-[11.5px] leading-[1.55] text-[#656358] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150">
      {children}
    </div>
  );
}

function PlanSteps({ steps }: { steps: TaskProgressStep[] }) {
  return (
    <div className="mt-2 max-w-[40rem] border-l border-[#dedad1] pl-3">
      <ol className="space-y-1.5">
        {steps.map((step) => {
          const Icon = planStepIcon(step.status);
          return (
            <li key={step.id} className="flex min-w-0 items-center gap-2 text-[12px] leading-5">
              <Icon
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-[#aaa69b]',
                  step.status === 'running' && 'text-[#d97757] motion-safe:animate-pulse',
                  step.status === 'completed' && 'text-emerald-600',
                  step.status === 'error' && 'text-red-500',
                )}
                strokeWidth={1.9}
                aria-hidden
              />
              <span
                className={cn(
                  'min-w-0 truncate text-[#77746b]',
                  step.status === 'running' && 'font-medium text-[#4f4c43]',
                  step.status === 'pending' && 'text-[#aaa69b]',
                  step.status === 'error' && 'text-red-600',
                )}
              >
                {step.title}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TechnicalBlock({ label, content, error = false }: { label: string; content: string; error?: boolean }) {
  return (
    <div className="mt-2 first:mt-0">
      <div className={cn('mb-1 text-[10px] font-medium text-[#aaa69b]', error && 'text-red-500/80')}>{label}</div>
      <pre
        className={cn(
          'max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.55] text-[#5f6b72]',
          error && 'text-red-600',
        )}
      >
        {content}
      </pre>
    </div>
  );
}

function DetailLine({ label, value, error = false }: { label: string; value: string; error?: boolean }) {
  return (
    <div className="mt-1 flex min-w-0 gap-2 first:mt-0">
      <span className={cn('shrink-0 text-[#aaa69b]', error && 'text-red-500/80')}>{label}</span>
      <span className={cn('min-w-0 break-all text-[#5f5b52]', error && 'text-red-600')}>{value}</span>
    </div>
  );
}

function entryIcon(entry: TaskNarrativeEntry): LucideIcon {
  if (entry.status === 'error') return AlertCircle;
  if (entry.kind === 'analysis') return Brain;
  if (entry.kind === 'plan') return ClipboardList;
  if (entry.kind === 'batch') return Layers3;
  if (entry.kind === 'file') return FilePenLine;
  if (entry.kind === 'media') return Image;
  if (entry.source === 'web') return Search;
  if (entry.source === 'browser') return Monitor;
  if (entry.source === 'shell') return Terminal;
  if (entry.source === 'mcp') return Plug;
  if (entry.source === 'file') return BookOpenText;
  if (entry.source === 'media') return Image;
  if (entry.title === '浏览网页') return Globe2;
  return Wrench;
}

function planStepIcon(status: TaskProgressStep['status']): LucideIcon {
  if (status === 'completed') return CheckCircle2;
  if (status === 'running') return CircleDashed;
  if (status === 'error') return AlertCircle;
  return Circle;
}

function hasExpandableDetails(entry: TaskNarrativeEntry): boolean {
  if (entry.kind === 'batch') return !!entry.childEntries?.length;
  if (entry.kind === 'plan') return !!entry.planSteps?.length;
  if (entry.kind === 'file') return !!(entry.fileEdit?.absolute_path || entry.error);
  return !!(
    entry.error
    || entry.result
    || (entry.input && Object.keys(entry.input).length > 0)
  );
}

function hasDiff(edit: NonNullable<TaskNarrativeEntry['fileEdit']>): boolean {
  return !edit.binary && (edit.added > 0 || edit.deleted > 0);
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
