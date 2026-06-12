import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FilePen,
  Loader2,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ExecutionStep } from '@/types/execution';
import type { Message, ToolCall } from '@/types';
import DetailBlockView from './DetailBlockView';

type ActivityStatus = 'running' | 'done' | 'error' | 'pending';

interface ActivityItem {
  id: string;
  label: string;
  detail?: string;
  status: ActivityStatus;
  source: 'reasoning' | 'tool' | 'file' | 'search' | 'shell' | 'mcp';
  input?: Record<string, unknown>;
  result?: string;
  detailBlocks?: ExecutionStep['detailBlocks'];
}

interface AgentActivityClusterProps {
  thinking?: string;
  activityMessages?: Message[];
  executionSteps?: ExecutionStep[];
  toolCalls?: ToolCall[];
  isActive: boolean;
  onRetry?: () => void;
}

function statusFromStep(status: ExecutionStep['status']): ActivityStatus {
  if (status === 'completed') return 'done';
  if (status === 'error') return 'error';
  if (status === 'running') return 'running';
  return 'pending';
}

function sourceFromName(name: string, type?: ExecutionStep['type']): ActivityItem['source'] {
  const compact = `${type ?? ''} ${name}`.toLowerCase();
  if (compact.includes('search') || compact.includes('web')) return 'search';
  if (compact.includes('shell') || compact.includes('command') || compact.includes('exec') || compact.includes('bash')) return 'shell';
  if (compact.includes('mcp')) return 'mcp';
  if (compact.includes('file') || compact.includes('patch') || compact.includes('write') || compact.includes('edit')) return 'file';
  return 'tool';
}

function itemFromStep(step: ExecutionStep): ActivityItem {
  return {
    id: step.id,
    label: step.label || step.toolName || 'Tool',
    detail: step.detail,
    status: statusFromStep(step.status),
    source: sourceFromName(step.toolName || step.label, step.type),
    input: step.toolInput,
    result: step.toolResult || step.errorMessage,
    detailBlocks: step.detailBlocks,
  };
}

function itemFromToolCall(toolCall: ToolCall): ActivityItem {
  return {
    id: toolCall.id,
    label: toolCall.name,
    status: toolCall.isError ? 'error' : toolCall.isExecuting ? 'running' : toolCall.result !== undefined ? 'done' : 'pending',
    source: sourceFromName(toolCall.name),
    input: toolCall.input,
    result: toolCall.result,
  };
}

function itemFromToolEvent(message: Message): ActivityItem[] {
  return (message.toolEvents ?? []).map((event, eventIndex) => {
    const name = event.name || (event as any).function?.name || 'tool';
    const input = (() => {
      const raw = event.arguments || (event as any).function?.arguments;
      if (typeof raw === 'string') {
        try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
      }
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    })();
    const result = typeof event.result === 'string'
      ? event.result
      : event.result ? JSON.stringify(event.result) : (event.error ? String(event.error) : undefined);
    return {
      id: event.call_id || `${message.id}:event:${eventIndex}`,
      label: name,
      status: event.phase === 'error' ? 'error' : event.phase === 'end' ? 'done' : event.phase === 'start' ? 'running' : 'pending',
      source: sourceFromName(name),
      input,
      result,
    };
  });
}

function itemFromFileEdit(message: Message): ActivityItem[] {
  return (message.fileEdits ?? []).map((edit, index) => ({
    id: edit.call_id || `${message.id}:file:${index}`,
    label: edit.path ? `${edit.operation === 'delete' ? 'Delete' : 'Edit'} ${edit.path.split('/').pop()}` : 'File edit',
    detail: edit.path,
    status: edit.status === 'error' || edit.phase === 'error'
      ? 'error'
      : edit.status === 'done' || edit.phase === 'end'
        ? 'done'
        : 'running',
    source: 'file',
    input: { path: edit.path, tool: edit.tool },
    result: edit.error || `+${edit.added ?? 0} -${edit.deleted ?? 0} lines`,
  }));
}

function itemFromTraceLine(message: Message): ActivityItem[] {
  if (message.toolEvents?.length || message.fileEdits?.length) return [];
  const lines = message.traces?.length
    ? message.traces
    : typeof message.content === 'string' && message.content.trim()
      ? [message.content]
      : [];
  return lines.map((line, index) => ({
    id: `${message.id}:trace:${index}`,
    label: line,
    status: message.isStreaming ? 'running' : 'done',
    source: sourceFromName(line),
  }));
}

const STATUS_RANK: Record<ActivityStatus, number> = {
  pending: 0,
  running: 1,
  done: 2,
  error: 3,
};

function mergeActivityItems(items: ActivityItem[]): ActivityItem[] {
  const out: ActivityItem[] = [];
  const indexById = new Map<string, number>();
  for (const item of items) {
    const existingIndex = indexById.get(item.id);
    if (existingIndex === undefined) {
      indexById.set(item.id, out.length);
      out.push(item);
      continue;
    }
    const existing = out[existingIndex];
    const shouldReplace = STATUS_RANK[item.status] >= STATUS_RANK[existing.status];
    out[existingIndex] = shouldReplace
      ? {
          ...existing,
          ...item,
          input: Object.keys(item.input ?? {}).length ? item.input : existing.input,
          result: item.result ?? existing.result,
          detailBlocks: item.detailBlocks?.length ? item.detailBlocks : existing.detailBlocks,
        }
      : existing;
  }
  return out;
}

function iconForSource(source: ActivityItem['source']) {
  if (source === 'reasoning') return Brain;
  if (source === 'file') return FilePen;
  if (source === 'search') return Search;
  if (source === 'shell') return Terminal;
  return Wrench;
}

function statusIcon(status: ActivityStatus, source: ActivityItem['source']) {
  if (status === 'running') return Loader2;
  if (status === 'done') return CheckCircle2;
  if (status === 'error') return AlertCircle;
  return iconForSource(source);
}

function sourceLabel(source: ActivityItem['source']): string {
  if (source === 'reasoning') return 'Thought';
  if (source === 'file') return 'File';
  if (source === 'search') return 'Search';
  if (source === 'shell') return 'Shell';
  if (source === 'mcp') return 'MCP';
  return 'Tool';
}

function elapsedLabel(startedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function shortText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function AgentActivityCluster({
  thinking,
  activityMessages,
  executionSteps,
  toolCalls,
  isActive,
  onRetry,
}: AgentActivityClusterProps) {
  const [userToggled, setUserToggled] = useState(false);
  const [open, setOpen] = useState(isActive);
  const [holdOpen, setHoldOpen] = useState(false);
  const [startedAt] = useState(Date.now());
  const [, tick] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [isActive]);

  useEffect(() => {
    if (userToggled) return;
    if (isActive) {
      setOpen(true);
      setHoldOpen(false);
      return;
    }
    setHoldOpen(true);
    const timer = window.setTimeout(() => {
      setHoldOpen(false);
      setOpen(false);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [isActive, userToggled]);

  const items = useMemo(() => {
    const rawItems = (() => {
    if (activityMessages?.length) {
      return activityMessages.flatMap((message) => [
        ...itemFromToolEvent(message),
        ...itemFromFileEdit(message),
        ...itemFromTraceLine(message),
      ]);
    }
    if (executionSteps?.length) return executionSteps.map(itemFromStep);
    return (toolCalls ?? []).filter((tool) => !tool.hidden).map(itemFromToolCall);
    })();
    return mergeActivityItems(rawItems);
  }, [activityMessages, executionSteps, toolCalls]);

  const hasThinking = !!thinking?.trim();
  const hasItems = items.length > 0;
  if (!hasThinking && !hasItems) return null;

  const hasError = items.some((item) => item.status === 'error');
  const runningCount = items.filter((item) => item.status === 'running').length;
  const doneCount = items.filter((item) => item.status === 'done').length;
  const expanded = userToggled ? open : open || holdOpen || isActive;
  const summary = isActive
    ? `Working for ${elapsedLabel(startedAt)}`
    : hasError
      ? 'Completed with errors'
      : hasItems
        ? `${doneCount}/${items.length} tool steps`
        : 'Thought';

  return (
    <div className="mb-3 rounded-xl border border-[#e8e4dd] bg-white/80 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => {
          setUserToggled(true);
          setOpen(!expanded);
        }}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-[#f5f3ee] transition-colors"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 text-[#8b887c] transition-transform', expanded && 'rotate-90')} />
        <div className="relative flex h-5 w-5 items-center justify-center rounded-full bg-[#f5f3ee]">
          {isActive ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d97757]" />
          ) : hasError ? (
            <AlertCircle className="h-3.5 w-3.5 text-red-500" />
          ) : (
            <Brain className="h-3.5 w-3.5 text-[#656358]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-[#29261b]">{summary}</span>
            {isActive && (
              <span className="inline-flex items-center gap-[3px]">
                <span className="typing-dot h-[3px] w-[3px] rounded-full bg-[#d97757]" />
                <span className="typing-dot h-[3px] w-[3px] rounded-full bg-[#d97757]" />
                <span className="typing-dot h-[3px] w-[3px] rounded-full bg-[#d97757]" />
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-[#8b887c]">
            {hasThinking ? 'Thought' : ''}
            {hasThinking && hasItems ? ' · ' : ''}
            {hasItems ? `${items.length} activity ${items.length === 1 ? 'step' : 'steps'}` : ''}
            {runningCount > 0 ? ` · ${runningCount} running` : ''}
          </div>
        </div>
        {onRetry && hasError && !isActive && (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onRetry();
            }}
            className="rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-100"
          >
            重试
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-[#e8e4dd] bg-[#fbfaf7] px-3.5 py-3">
          <div className="max-h-64 overflow-y-auto pr-1">
            {hasThinking && (
              <ReasoningActivityRow thinking={thinking!} running={isActive && !hasItems} />
            )}
            {items.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReasoningActivityRow({ thinking, running }: { thinking: string; running: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 rounded-lg border border-[#e8e4dd] bg-white">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-[#8b887c]" /> : <ChevronRight className="h-3.5 w-3.5 text-[#8b887c]" />}
        <Brain className={cn('h-3.5 w-3.5', running ? 'text-[#d97757]' : 'text-[#656358]')} />
        <span className="flex-1 text-[12.5px] font-medium text-[#29261b]">Thought process</span>
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d97757]" /> : <Clock className="h-3.5 w-3.5 text-[#b0ad9f]" />}
      </button>
      {open && (
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words border-t border-[#e8e4dd] px-3 py-2 text-[12px] leading-relaxed text-[#656358]">
          {thinking}
        </pre>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const Icon = statusIcon(item.status, item.source);
  const hasDetails = !!shortText(item.input) || !!item.result || !!item.detailBlocks?.length;
  return (
    <div className="mb-2 rounded-lg border border-[#e8e4dd] bg-white">
      <button
        type="button"
        onClick={() => hasDetails && setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Icon
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            item.status === 'running' && 'animate-spin text-[#d97757]',
            item.status === 'done' && 'text-emerald-600',
            item.status === 'error' && 'text-red-500',
            item.status === 'pending' && 'text-[#8b887c]',
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[#29261b]">
          {item.label}
        </span>
        <span className="rounded bg-[#f5f3ee] px-1.5 py-0.5 text-[10px] font-medium text-[#8b887c]">
          {sourceLabel(item.source)}
        </span>
        {hasDetails && (
          <ChevronRight className={cn('h-3.5 w-3.5 text-[#b0ad9f] transition-transform', open && 'rotate-90')} />
        )}
      </button>
      {item.detail && (
        <div className="px-3 pb-2 text-[11.5px] text-[#8b887c]">{item.detail}</div>
      )}
      {open && hasDetails && (
        <div className="space-y-2 border-t border-[#e8e4dd] bg-[#1f1f1f] px-3 py-2.5">
          {!!item.detailBlocks?.length && (
            <div className="flex flex-wrap gap-1.5">
              {item.detailBlocks.map((block) => (
                <DetailBlockView key={block.id} block={block} onToggle={() => {}} />
              ))}
            </div>
          )}
          {!!shortText(item.input) && (
            <div>
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-white/35">Input</div>
              <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[#a8c5da]">
                {shortText(item.input)}
              </pre>
            </div>
          )}
          {item.result && (
            <div className="border-t border-white/10 pt-2">
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-white/35">Output</div>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[#b5c9a8]">
                {item.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
