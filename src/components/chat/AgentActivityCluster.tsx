import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  CircleDashed,
  FilePen,
  Globe,
  Loader2,
  Monitor,
  Plug,
  Search,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskProgressStep } from '@/core/types';
import type { ExecutionStep } from '@/types/execution';
import type { Message, ToolCall } from '@/types';
import type {
  ActivityEvidence,
  ActivityItem as TimelineActivityItem,
  ActivityStepSource,
} from '@/core/nanobot/activityTimeline';
import {
  activityEvidenceFromMessageMedia,
  activityEvidenceFromToolEvent,
  activitySourceFromToolName,
} from '@/core/nanobot/activityTimeline';
import { ActivityEvidencePreview } from './activity/ActivityEvidencePreview';
import { ActivityGroup } from './activity/ActivityGroup';
import { ActivityStep } from './activity/ActivityStep';
import { FileEditGroup, type FileEditSummary } from './activity/FileEditRow';
import { toolActivityLabel } from '@/core/nanobot/toolDisplay';

type ActivityStatus = 'running' | 'done' | 'error' | 'pending';

interface ProgressStage {
  label: string;
  status: ActivityStatus;
}

interface ActivityRowItem {
  id: string;
  label: string;
  detail?: string;
  status: ActivityStatus;
  source: ActivityStepSource;
  input?: Record<string, unknown>;
  result?: string;
  preview?: ActivityEvidence[];
  error?: string;
}

interface AgentActivityClusterProps {
  thinking?: string;
  activityMessages?: Message[];
  activityItems?: TimelineActivityItem[];
  turnLatencyMs?: number;
  executionSteps?: ExecutionStep[];
  toolCalls?: ToolCall[];
  isActive?: boolean;
  hasBodyBelow?: boolean;
  onRetry?: () => void;
}

const STATUS_RANK: Record<ActivityStatus, number> = {
  pending: 0,
  running: 1,
  done: 2,
  error: 3,
};

function toolEventName(event: NonNullable<Message['toolEvents']>[number]): string {
  const fn = (event as { function?: { name?: unknown } }).function;
  return typeof event.name === 'string'
    ? event.name
    : typeof fn?.name === 'string'
      ? fn.name
      : 'tool';
}

function toolEventArgs(event: NonNullable<Message['toolEvents']>[number]): Record<string, unknown> {
  const fn = (event as { function?: { arguments?: unknown } }).function;
  const raw = event.arguments ?? fn?.arguments;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function toolEventResult(event: NonNullable<Message['toolEvents']>[number]): string | undefined {
  if (typeof event.result === 'string') return event.result;
  if (event.result !== undefined && event.result !== null) return JSON.stringify(event.result);
  if (event.error !== undefined && event.error !== null) return String(event.error);
  return undefined;
}

function sourceFromName(name: string, type?: ExecutionStep['type']): ActivityStepSource {
  return activitySourceFromToolName(`${type ?? ''} ${name}`);
}

function itemFromStep(step: ExecutionStep): ActivityRowItem {
  const status = step.status === 'completed' ? 'done' : step.status === 'error' ? 'error' : step.status === 'running' ? 'running' : 'pending';
  return {
    id: step.id,
    label: toolActivityLabel(step.toolName || step.label || '', status, step.toolInput, step.toolResult),
    status,
    source: sourceFromName(step.toolName || step.label, step.type),
    input: step.toolInput,
    result: step.toolResult || step.errorMessage,
    error: step.errorMessage,
  };
}

function itemFromToolCall(toolCall: ToolCall): ActivityRowItem {
  const status = toolCall.isError ? 'error' : toolCall.isExecuting ? 'running' : toolCall.result !== undefined ? 'done' : 'pending';
  return {
    id: toolCall.id,
    label: toolActivityLabel(toolCall.name, status, toolCall.input, toolCall.result),
    status,
    source: activitySourceFromToolName(toolCall.name),
    input: toolCall.input,
    result: toolCall.result,
    error: toolCall.isError ? toolCall.result : undefined,
  };
}

function itemFromToolEvent(message: Message): ActivityRowItem[] {
  return (message.toolEvents ?? []).flatMap((event, eventIndex) => {
    const name = toolEventName(event);
    if (name === 'update_task_progress') return [];
    const error = event.error ? String(event.error) : undefined;
    const status = event.phase === 'error' ? 'error' : event.phase === 'end' ? 'done' : event.phase === 'start' ? 'running' : 'pending';
    return [{
      id: event.call_id || `${message.id}:event:${eventIndex}`,
      label: toolActivityLabel(name, status, toolEventArgs(event), toolEventResult(event)),
      status,
      source: activitySourceFromToolName(name),
      input: toolEventArgs(event),
      result: toolEventResult(event),
      preview: activityEvidenceFromToolEvent(event),
      error,
    }];
  });
}

function itemFromTraceLine(message: Message): ActivityRowItem[] {
  if (message.toolEvents?.length || message.fileEdits?.length) return [];
  const lines = message.traces?.length
    ? message.traces
    : typeof message.content === 'string' && message.content.trim()
      ? [message.content]
      : [];
  return lines.map((line, index) => ({
    id: `${message.id}:trace:${index}`,
    label: toolActivityLabel('', message.isStreaming ? 'running' : 'done'),
    status: message.isStreaming ? 'running' : 'done',
    source: activitySourceFromToolName(line),
  }));
}

function itemFromMedia(message: Message): ActivityRowItem[] {
  const evidence = activityEvidenceFromMessageMedia(message);
  if (!evidence.length) return [];
  return [{
    id: `${message.id}:media`,
    label: evidence.length === 1 ? (evidence[0].caption || 'Media') : `${evidence.length} media attachments`,
    status: message.isStreaming ? 'running' : 'done',
    source: 'media',
    preview: evidence,
  }];
}

function taskProgressFromMessages(messages: Message[]): ProgressStage[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const agentUI = messages[i].agentUI;
    if (agentUI?.kind !== 'task_progress' || !Array.isArray(agentUI.steps)) continue;
    return agentUI.steps
      .map((step: TaskProgressStep): ProgressStage => ({
        label: step.title,
        status: taskProgressStatus(step.status),
      }))
      .filter((step) => step.label.trim())
      .slice(0, 8);
  }
  return [];
}

function taskProgressStatus(status: TaskProgressStep['status']): ActivityStatus {
  if (status === 'completed') return 'done';
  if (status === 'running' || status === 'pending' || status === 'error') return status;
  return 'pending';
}

function itemsFromTimelineItem(item: TimelineActivityItem): ActivityRowItem[] {
  const message = item.message;
  if (item.type === 'reasoning') return [];
  if (item.type === 'file_edit') return [];
  if (item.type === 'media') return itemFromMedia(message);
  if (item.type === 'cli' || item.type === 'mcp' || item.type === 'tool') {
    const toolItems = itemFromToolEvent(message);
    return toolItems.length > 0 ? toolItems : itemFromTraceLine(message);
  }
  return itemFromTraceLine(message);
}

function mergeActivityItems(items: ActivityRowItem[]): ActivityRowItem[] {
  const out: ActivityRowItem[] = [];
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
          preview: item.preview?.length ? item.preview : existing.preview,
          error: item.error ?? existing.error,
        }
      : existing;
  }
  return out;
}

function fileEditKey(edit: NonNullable<Message['fileEdits']>[number]): string {
  if (edit.call_id) return `${edit.call_id}|${edit.tool}`;
  return `${edit.tool}|${edit.path}`;
}

function fileEditSummaries(messages: Message[]): FileEditSummary[] {
  const out = new Map<string, FileEditSummary>();
  for (const message of messages) {
    for (const edit of message.fileEdits ?? []) {
      const key = fileEditKey(edit);
      const existing = out.get(key);
      out.set(key, {
        key,
        path: edit.path,
        absolute_path: edit.absolute_path,
        added: edit.added ?? existing?.added ?? 0,
        deleted: edit.deleted ?? existing?.deleted ?? 0,
        approximate: !!edit.approximate,
        binary: !!edit.binary,
        status: edit.status,
        operation: edit.operation,
        pending: !!edit.pending,
        error: edit.error ?? existing?.error,
      });
    }
  }
  return Array.from(out.values());
}

function reasoningText(messages: Message[], explicit?: string): string {
  if (explicit?.trim()) return explicit;
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.thinking)
    .filter(Boolean)
    .join('\n');
}

function groupTitle(source: ActivityStepSource): string {
  if (source === 'web') return '资料查询';
  if (source === 'browser') return '网页操作';
  if (source === 'shell') return '数据处理';
  if (source === 'mcp') return '外部数据';
  if (source === 'file') return '文件处理';
  if (source === 'media') return '内容生成';
  if (source === 'reasoning') return '任务分析';
  return '任务步骤';
}

function groupIcon(source: ActivityStepSource): LucideIcon {
  if (source === 'web') return Globe;
  if (source === 'browser') return Monitor;
  if (source === 'shell') return Terminal;
  if (source === 'mcp') return Plug;
  if (source === 'file') return FilePen;
  if (source === 'media') return Search;
  if (source === 'reasoning') return Brain;
  return Wrench;
}

function statusTone(status: ActivityStatus): 'neutral' | 'active' | 'success' | 'error' {
  if (status === 'running') return 'active';
  if (status === 'done') return 'success';
  if (status === 'error') return 'error';
  return 'neutral';
}

function statusIcon(status: ActivityStatus): LucideIcon {
  if (status === 'running') return CircleDashed;
  if (status === 'done') return CheckCircle2;
  if (status === 'error') return AlertCircle;
  return Wrench;
}

function elapsedLabel(startedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function groupedItems(items: ActivityRowItem[]): Array<{ source: ActivityStepSource; items: ActivityRowItem[] }> {
  const order: ActivityStepSource[] = ['web', 'browser', 'shell', 'mcp', 'file', 'media', 'tool'];
  const groups = new Map<ActivityStepSource, ActivityRowItem[]>();
  for (const item of items) {
    const key = item.source === 'reasoning' ? 'tool' : item.source;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return order
    .filter((source) => groups.has(source))
    .map((source) => ({ source, items: groups.get(source)! }));
}

export default function AgentActivityCluster({
  thinking,
  activityMessages = [],
  activityItems,
  turnLatencyMs,
  executionSteps,
  toolCalls,
  isActive = false,
  hasBodyBelow,
  onRetry,
}: AgentActivityClusterProps) {
  const [userToggled, setUserToggled] = useState(false);
  const [open, setOpen] = useState(isActive);
  const [startedAt] = useState(Date.now());
  const [, tick] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [isActive]);

  useEffect(() => {
    if (userToggled) return;
    if (isActive) {
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [isActive, userToggled]);

  useEffect(() => {
    if (!isActive || !open) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activityMessages.length, activityItems?.length, isActive, open]);

  const items = useMemo(() => {
    const rawItems = (() => {
      if (activityItems?.length) return activityItems.flatMap(itemsFromTimelineItem);
      if (activityMessages.length) {
        return activityMessages.flatMap((message) => [
          ...itemFromToolEvent(message),
          ...itemFromTraceLine(message),
          ...itemFromMedia(message),
        ]);
      }
      if (executionSteps?.length) return executionSteps.map(itemFromStep);
      return (toolCalls ?? []).filter((tool) => !tool.hidden).map(itemFromToolCall);
    })();
    return mergeActivityItems(rawItems);
  }, [activityItems, activityMessages, executionSteps, toolCalls]);

  const edits = useMemo(() => fileEditSummaries(activityMessages), [activityMessages]);
  const thought = useMemo(() => reasoningText(activityMessages, thinking), [activityMessages, thinking]);
  const hasThinking = !!thought.trim();
  const hasItems = items.length > 0;
  const hasEdits = edits.length > 0;
  if (!hasThinking && !hasItems && !hasEdits) return null;

  const hasError = items.some((item) => item.status === 'error') || edits.some((edit) => edit.status === 'error');
  const runningCount = items.filter((item) => item.status === 'running').length + edits.filter((edit) => edit.status === 'editing').length;
  const completedCount = items.filter((item) => item.status === 'done').length + edits.filter((edit) => edit.status === 'done').length;
  const stepCount = items.length + edits.length;
  const explicitProgressStages = taskProgressFromMessages(activityMessages);
  const progressStages = explicitProgressStages;
  const expanded = userToggled ? open : open || isActive;
  const summary = isActive
    ? `正在处理 · ${elapsedLabel(startedAt)}`
    : hasError
      ? '处理未完全完成'
      : stepCount > 0
        ? `已完成 ${completedCount}/${stepCount} 个步骤`
        : '任务分析完成';

  const grouped = groupedItems(items);

  return (
    <div className={cn('rounded-xl border border-[#e8e4dd] bg-white/80 shadow-sm overflow-hidden', hasBodyBelow && 'mb-1')}>
      <button
        type="button"
        onClick={() => {
          setUserToggled(true);
          setOpen(!expanded);
        }}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-[#f5f3ee] transition-colors"
      >
        <span className={cn('h-3.5 w-3.5 text-[#8b887c] transition-transform', expanded && 'rotate-90')}>›</span>
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
            {hasThinking ? '正在分析' : ''}
            {hasThinking && stepCount > 0 ? ' · ' : ''}
            {stepCount > 0 ? `${stepCount} 个任务步骤` : ''}
            {runningCount > 0 ? ` · ${runningCount} 个进行中` : ''}
            {!isActive && turnLatencyMs !== undefined ? ` · ${formatDuration(turnLatencyMs)}` : ''}
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
          <div ref={scrollRef} className="max-h-72 overflow-y-auto pr-1">
            {progressStages.length > 0 ? (
              <ProgressSummary stages={progressStages} />
            ) : null}

            {hasEdits && (
              <ActivityGroup title="文件更新" icon={FilePen}>
                <FileEditGroup edits={edits} />
              </ActivityGroup>
            )}

            {grouped.map((group) => (
              <ActivityGroup key={group.source} title={groupTitle(group.source)} icon={groupIcon(group.source)}>
                <ul className="space-y-1">
                  {group.items.map((item) => (
                    <ToolActivityRow key={item.id} item={item} />
                  ))}
                </ul>
              </ActivityGroup>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressSummary({ stages }: { stages: ProgressStage[] }) {
  return (
    <div className="mb-3 rounded-xl border border-[#e8e4dd] bg-white px-3.5 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[14px] font-semibold text-[#29261b]">进度</div>
      </div>
      <ol className="space-y-2">
        {stages.map((stage, index) => (
          <li key={`${stage.label}-${index}`} className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-medium',
                stage.status === 'running' && 'bg-[#edf4ff] text-[#3b82f6]',
                stage.status === 'done' && 'bg-[#f3f2ee] text-[#656358]',
                stage.status === 'pending' && 'bg-[#f3f2ee] text-[#8b887c]',
                stage.status === 'error' && 'bg-red-50 text-red-600',
              )}
            >
              {stage.status === 'done' ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
            </span>
            <span
              className={cn(
                'min-w-0 truncate text-[13.5px] font-medium',
                stage.status === 'running' ? 'text-[#29261b]' : 'text-[#656358]',
                stage.status === 'pending' && 'text-[#8b887c]',
                stage.status === 'error' && 'text-red-600',
              )}
            >
              {stage.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ToolActivityRow({ item }: { item: ActivityRowItem }) {
  const Icon = statusIcon(item.status);
  const active = item.status === 'running';
  const tone = statusTone(item.status);
  return (
    <ActivityStep
      as="li"
      icon={Icon}
      active={active}
      tone={tone}
      label={item.label}
    >
      {item.preview?.length ? <ActivityEvidencePreview evidence={item.preview} /> : null}
    </ActivityStep>
  );
}
