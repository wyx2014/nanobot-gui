import type { TaskProgressStep, ToolProgressEvent, UIFileEdit } from '@/core/types';
import type { Message } from '@/types';
import {
  activityEvidenceFromMessageMedia,
  activityEvidenceFromToolEvent,
  activitySourceFromToolName,
  type ActivityEvidence,
  type ActivityStepSource,
} from './activityTimeline';
import { toolActivityLabel } from './toolDisplay';

export type TaskNarrativeStatus = 'pending' | 'running' | 'done' | 'error';
export type TaskNarrativeKind = 'analysis' | 'plan' | 'batch' | 'tool' | 'file' | 'media';

export interface TaskNarrativeEntry {
  id: string;
  kind: TaskNarrativeKind;
  title: string;
  detail?: string;
  status: TaskNarrativeStatus;
  source: ActivityStepSource;
  input?: Record<string, unknown>;
  result?: string;
  error?: string;
  evidence?: ActivityEvidence[];
  planSteps?: TaskProgressStep[];
  fileEdit?: UIFileEdit;
  sequence?: number;
  batchId?: string;
  occurredAt?: number;
  importance?: 'primary' | 'secondary' | string;
  childEntries?: TaskNarrativeEntry[];
}

const STATUS_RANK: Record<TaskNarrativeStatus, number> = {
  pending: 0,
  running: 1,
  done: 2,
  error: 3,
};

/**
 * Project gateway activity messages into a stable, user-facing timeline.
 * Entries keep their first-seen position while start/end/error frames update
 * the same row through call_id. This is a presentation projection only: the
 * nanobot transcript remains the source of truth.
 */
export function buildTaskNarrativeEntries(messages: Message[]): TaskNarrativeEntry[] {
  const entries: TaskNarrativeEntry[] = [];
  const entryIndex = new Map<string, number>();
  const hasExpertTeamPlan = messages.some((message) => message.id.startsWith('team-run-'));
  const expertProjection = hasExpertTeamPlan ? buildExpertTeamProjection(messages) : undefined;

  const upsert = (key: string, entry: TaskNarrativeEntry) => {
    const index = entryIndex.get(key);
    if (index === undefined) {
      entryIndex.set(key, entries.length);
      entries.push(entry);
      return;
    }
    const previous = entries[index];
    const keepNewStatus = STATUS_RANK[entry.status] >= STATUS_RANK[previous.status];
    entries[index] = {
      ...previous,
      ...entry,
      id: previous.id,
      status: keepNewStatus ? entry.status : previous.status,
      input: hasKeys(entry.input) ? entry.input : previous.input,
      result: entry.result ?? previous.result,
      error: entry.error ?? previous.error,
      evidence: entry.evidence?.length ? entry.evidence : previous.evidence,
      planSteps: entry.planSteps?.length ? entry.planSteps : previous.planSteps,
      fileEdit: entry.fileEdit ?? previous.fileEdit,
      childEntries: entry.childEntries?.length ? entry.childEntries : previous.childEntries,
    };
  };

  messages.forEach((message) => {
    if (isReasoningActivity(message)) {
      const running = !!(message.reasoningStreaming || message.isStreaming);
      upsert('analysis', {
        id: `${message.id}:analysis`,
        kind: 'analysis',
        title: '整理思路',
        detail: running ? '正在分析任务' : '已完成任务分析',
        status: running ? 'running' : 'done',
        source: 'reasoning',
      });
    }

    const explicitPlan = taskProgressSteps(message.agentUI);
    const isExpertTeamPlan = message.id.startsWith('team-run-');
    if (explicitPlan.length && (!hasExpertTeamPlan || isExpertTeamPlan)) {
      const visibleSteps = isExpertTeamPlan && expertProjection
        ? projectExpertTeamSteps(explicitPlan, expertProjection)
        : explicitPlan;
      upsert('plan', planEntry(
        `${message.id}:plan`,
        visibleSteps,
        expertProjection?.note || taskProgressNote(message.agentUI),
        isExpertTeamPlan ? '专家团队研究' : '整理计划',
      ));
    }

    const toolEvents = orderedToolEvents(message.toolEvents ?? []);
    toolEvents.forEach(({ event, originalIndex: eventIndex }) => {
      const name = toolEventName(event);
      const input = toolEventArgs(event);
      if (name === 'update_task_progress') {
        if (!hasExpertTeamPlan && !explicitPlan.length) {
          const fallbackPlan = taskProgressStepsFromInput(input);
          if (fallbackPlan.length) {
            upsert('plan', planEntry(
              `${message.id}:plan`,
              fallbackPlan,
              cleanString(input.note),
            ));
          }
        }
        return;
      }
      if (hasExpertTeamPlan) return;

      const status = toolEventStatus(event);
      const source = activitySourceFromToolName(name);
      const result = toolEventResult(event);
      const error = event.error == null ? undefined : String(event.error);
      const callId = event.call_id || `${message.id}:${eventIndex}`;
      const display = event.display;
      const fallbackDetail = toolActivityLabel(name, status, input, result);
      upsert(`tool:${callId}`, {
        id: `tool:${callId}`,
        kind: 'tool',
        title: display?.title?.trim() || taskActionTitle(name, source, display?.category),
        detail: display?.detail?.trim() || displaySubjectDetail(display?.subject, fallbackDetail),
        status,
        source,
        input,
        result,
        error,
        evidence: activityEvidenceFromToolEvent(event),
        sequence: finiteNumber(event.sequence),
        batchId: cleanString(event.batch_id),
        occurredAt: finiteNumber(event.occurred_at),
        importance: display?.importance,
      });
    });

    for (const edit of message.fileEdits ?? []) {
      const key = `${edit.call_id || message.id}:${edit.tool}:${edit.path}`;
      const status: TaskNarrativeStatus = edit.status === 'error'
        ? 'error'
        : edit.status === 'editing'
          ? 'running'
          : 'done';
      upsert(`file:${key}`, {
        id: `file:${key}`,
        kind: 'file',
        title: fileActionTitle(edit),
        detail: edit.path || (status === 'running' ? '正在准备文件变更' : '文件变更已完成'),
        status,
        source: 'file',
        error: edit.error,
        fileEdit: edit,
      });
    }

    const messageEvidence = activityEvidenceFromMessageMedia(message);
    if (messageEvidence.length) {
      upsert(`media:${message.id}`, {
        id: `media:${message.id}`,
        kind: 'media',
        title: '生成内容',
        detail: mediaDetail(messageEvidence),
        status: message.isStreaming ? 'running' : 'done',
        source: 'media',
        evidence: messageEvidence,
      });
    }

    if (!hasExpertTeamPlan && !explicitPlan.length && toolEvents.length === 0 && !message.fileEdits?.length && !messageEvidence.length) {
      traceLines(message).forEach((line, traceIndex) => {
        const source = activitySourceFromToolName(line);
        const status = message.isStreaming ? 'running' : 'done';
        upsert(`trace:${message.id}:${traceIndex}`, {
          id: `trace:${message.id}:${traceIndex}`,
          kind: 'tool',
          title: taskActionTitle(line, source),
          detail: compactTraceDetail(line),
          status,
          source,
        });
      });
    }
  });

  return groupParallelEntries(entries);
}

interface ExpertTeamProjection {
  teamLeadStatus?: TaskProgressStep['status'];
  auditStatus?: TaskProgressStep['status'];
  activeStage?: 'team-lead' | 'report-audit';
  activity?: string;
  note?: string;
}

function buildExpertTeamProjection(messages: Message[]): ExpertTeamProjection {
  const projection: ExpertTeamProjection = {};
  for (const message of messages) {
    const snapshots: Array<{ steps: TaskProgressStep[]; note?: string }> = [];
    const directSteps = taskProgressSteps(message.agentUI);
    if (directSteps.length && !message.id.startsWith('team-run-')) {
      snapshots.push({ steps: directSteps, note: taskProgressNote(message.agentUI) });
    }
    const toolEvents = orderedToolEvents(message.toolEvents ?? []);
    for (const { event } of toolEvents) {
      const name = toolEventName(event);
      const input = toolEventArgs(event);
      if (name === 'update_task_progress') {
        const steps = taskProgressStepsFromInput(input);
        if (steps.length) snapshots.push({ steps, note: cleanString(input.note) });
        continue;
      }
      if (name === 'spawn') continue;
      if (!projection.activeStage) continue;
      const status = toolEventStatus(event);
      const result = toolEventResult(event);
      projection.activity = toolActivityLabel(name, status, input, result);
    }
    for (const snapshot of snapshots) {
      // Older/model-generated plans sometimes used `team-lead` for the
      // pre-research data package and `team-lead-summary` for the real
      // synthesis stage. Prefer the explicit summary alias and never project
      // a data-package step onto the canonical Team Lead row.
      const lead = snapshot.steps.find((step) => step.id === 'team-lead-summary')
        ?? snapshot.steps.find(isTeamLeadSynthesisStep);
      const audit = snapshot.steps.find((step) => (
        step.id === 'data-audit' || step.id === 'report-audit'
      ));
      if (lead) projection.teamLeadStatus = lead.status;
      if (audit) projection.auditStatus = audit.status;
      const hasStageSnapshot = Boolean(lead || audit);
      const nextStage: ExpertTeamProjection['activeStage'] = audit?.status === 'running'
        ? 'report-audit'
        : lead?.status === 'running'
          ? 'team-lead'
          : undefined;
      if (hasStageSnapshot && nextStage !== projection.activeStage) {
        projection.activeStage = nextStage;
        projection.activity = undefined;
      }
      if (snapshot.note) projection.note = snapshot.note;
    }
  }
  return projection;
}

function isTeamLeadSynthesisStep(step: TaskProgressStep): boolean {
  if (step.id !== 'team-lead') return false;
  const title = step.title.toLowerCase();
  return ![
    '基础数据',
    '数据包',
    '构建数据',
    '准备数据',
    '取数',
    'data package',
    'data-package',
  ].some((marker) => title.includes(marker));
}

function projectExpertTeamSteps(
  steps: TaskProgressStep[],
  projection: ExpertTeamProjection,
): TaskProgressStep[] {
  return steps.map((step) => {
    if (step.id === 'team-lead') {
      return {
        ...step,
        status: projection.teamLeadStatus || step.status,
        detail: projection.activeStage === 'team-lead' && projection.activity
          ? projection.activity
          : projection.teamLeadStatus === 'running'
            ? '正在交叉核验成员结论并补齐缺失维度'
            : step.detail,
      };
    }
    if (step.id === 'report-audit') {
      return {
        ...step,
        status: projection.auditStatus || step.status,
        detail: projection.activeStage === 'report-audit' && projection.activity
          ? projection.activity
          : projection.auditStatus === 'running'
            ? '正在抽检关键财务数据并生成最终报告'
            : step.detail,
      };
    }
    return step;
  });
}

function planEntry(id: string, steps: TaskProgressStep[], note?: string, title = '整理计划'): TaskNarrativeEntry {
  const status = planStatus(steps);
  const failed = steps.find((step) => step.status === 'error');
  const running = steps.find((step) => step.status === 'running');
  const pending = steps.find((step) => step.status === 'pending');
  const statusDetail = failed
    ? `中断：${failed.title}`
    : running
      ? `处理：${running.title}`
      : status === 'done'
        ? `校验：已完成 ${steps.length} 项计划`
        : pending
          ? `准备：${pending.title}`
          : undefined;
  return {
    id,
    kind: 'plan',
    title,
    detail: note || statusDetail,
    status,
    source: 'tool',
    planSteps: steps,
  };
}

function taskProgressNote(agentUI: Message['agentUI']): string | undefined {
  if (!agentUI || agentUI.kind !== 'task_progress') return undefined;
  return cleanString(agentUI.note);
}

function taskProgressSteps(agentUI: Message['agentUI']): TaskProgressStep[] {
  if (!agentUI || agentUI.kind !== 'task_progress' || !Array.isArray(agentUI.steps)) return [];
  const steps = normalizeTaskProgressSteps(agentUI.steps);
  const currentStepId = cleanString(agentUI.current_step_id);
  if (!currentStepId || steps.some((step) => step.status === 'running')) return steps;
  return steps.map((step) => step.id === currentStepId && step.status === 'pending'
    ? { ...step, status: 'running' }
    : step);
}

function taskProgressStepsFromInput(input: Record<string, unknown>): TaskProgressStep[] {
  const steps = normalizeTaskProgressSteps(Array.isArray(input.steps) ? input.steps : []);
  const currentStepId = cleanString(input.current_step_id);
  if (!currentStepId || steps.some((step) => step.status === 'running')) return steps;
  return steps.map((step) => step.id === currentStepId && step.status === 'pending'
    ? { ...step, status: 'running' }
    : step);
}

function normalizeTaskProgressSteps(steps: unknown[]): TaskProgressStep[] {
  return steps.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const record = raw as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    if (!title) return [];
    const rawStatus = record.status;
    const status: TaskProgressStep['status'] = rawStatus === 'running'
      || rawStatus === 'completed'
      || rawStatus === 'error'
      || rawStatus === 'pending'
      ? rawStatus
      : 'pending';
    return [{
      id: typeof record.id === 'string' && record.id.trim() ? record.id : `step-${index + 1}`,
      title,
      detail: typeof record.detail === 'string' && record.detail.trim() ? record.detail.trim() : undefined,
      status,
    }];
  });
}

function planStatus(steps: TaskProgressStep[]): TaskNarrativeStatus {
  if (steps.some((step) => step.status === 'error')) return 'error';
  if (steps.some((step) => step.status === 'running')) return 'running';
  if (steps.length > 0 && steps.every((step) => step.status === 'completed')) return 'done';
  return 'pending';
}

function orderedToolEvents(events: ToolProgressEvent[]): Array<{ event: ToolProgressEvent; originalIndex: number }> {
  return events
    .map((event, originalIndex) => ({ event, originalIndex }))
    .sort((left, right) => {
      const leftSequence = finiteNumber(left.event.sequence);
      const rightSequence = finiteNumber(right.event.sequence);
      if (leftSequence === undefined || rightSequence === undefined) {
        return left.originalIndex - right.originalIndex;
      }
      return leftSequence - rightSequence || left.originalIndex - right.originalIndex;
    });
}

function groupParallelEntries(entries: TaskNarrativeEntry[]): TaskNarrativeEntry[] {
  const grouped: TaskNarrativeEntry[] = [];
  let index = 0;
  while (index < entries.length) {
    const current = entries[index];
    if (current.kind !== 'tool' || !current.batchId) {
      grouped.push(current);
      index += 1;
      continue;
    }

    const children: TaskNarrativeEntry[] = [current];
    let nextIndex = index + 1;
    while (
      nextIndex < entries.length
      && entries[nextIndex].kind === 'tool'
      && entries[nextIndex].batchId === current.batchId
    ) {
      children.push(entries[nextIndex]);
      nextIndex += 1;
    }

    if (children.length === 1) {
      grouped.push(current);
      index = nextIndex;
      continue;
    }

    const status = aggregateStatus(children);
    const errorCount = children.filter((entry) => entry.status === 'error').length;
    const expertBatch = children.every((entry) => (
      typeof entry.input?.label === 'string'
      && ['business-analyst', 'financial-analyst', 'industry-researcher', 'risk-assessor'].includes(entry.input.label)
    ));
    grouped.push({
      id: `batch:${current.batchId}`,
      kind: 'batch',
      title: expertBatch ? '专家团队并行研究' : '并行执行',
      detail: status === 'running'
        ? expertBatch
          ? `${children.map((entry) => entry.title).join('、')}正在同步推进`
          : `正在并行处理 ${children.length} 项任务`
        : errorCount > 0
          ? `${errorCount} 项未完成，其余任务已结束`
          : `已完成 ${children.length} 项并行任务`,
      status,
      source: 'tool',
      sequence: current.sequence,
      batchId: current.batchId,
      occurredAt: current.occurredAt,
      childEntries: children,
    });
    index = nextIndex;
  }
  return grouped;
}

function aggregateStatus(entries: TaskNarrativeEntry[]): TaskNarrativeStatus {
  if (entries.some((entry) => entry.status === 'running')) return 'running';
  if (entries.some((entry) => entry.status === 'error')) return 'error';
  if (entries.length > 0 && entries.every((entry) => entry.status === 'done')) return 'done';
  return 'pending';
}

function isReasoningActivity(message: Message): boolean {
  if (message.role !== 'assistant' || message.kind === 'trace') return false;
  const content = messageText(message);
  return !content && !!(message.thinking || message.reasoningStreaming || message.isStreaming);
}

function messageText(message: Message): string {
  if (typeof message.content === 'string') return message.content.trim();
  const block = message.content.find((candidate) => candidate.type === 'text');
  return block?.type === 'text' ? block.text.trim() : '';
}

function toolEventName(event: ToolProgressEvent): string {
  const fn = (event as { function?: { name?: unknown } }).function;
  if (typeof event.name === 'string') return event.name;
  return typeof fn?.name === 'string' ? fn.name : 'tool';
}

function toolEventArgs(event: ToolProgressEvent): Record<string, unknown> {
  const fn = (event as { function?: { arguments?: unknown } }).function;
  const raw = event.arguments ?? fn?.arguments;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
}

function toolEventResult(event: ToolProgressEvent): string | undefined {
  if (typeof event.result === 'string') return event.result;
  if (event.result === undefined || event.result === null) return undefined;
  try {
    return JSON.stringify(event.result, null, 2);
  } catch {
    return String(event.result);
  }
}

function toolEventStatus(event: ToolProgressEvent): TaskNarrativeStatus {
  if (event.phase === 'error') return 'error';
  if (event.phase === 'end') return 'done';
  if (event.phase === 'start') return 'running';
  return 'pending';
}

function taskActionTitle(name: string, source: ActivityStepSource, category?: string): string {
  const compact = name.toLowerCase();
  if (category === 'plan') return '整理计划';
  if (category === 'skill') return '加载技能';
  if (category === 'command') return '运行命令';
  if (category === 'search') return '查询资料';
  if (category === 'browser') return '浏览网页';
  if (category === 'read') return '读取资料';
  if (category === 'write' || category === 'file') return '写入文件';
  if (category === 'mcp') return '查询外部数据';
  if (category === 'expert') return '专家角色研究';
  if (category === 'media') return '生成内容';
  if (compact.includes('task_progress') || compact.includes('plan')) return '整理计划';
  if (compact.includes('skill')) return '加载技能';
  if (compact.includes('exec') || compact.includes('shell') || compact.includes('command') || /^\s*\$/.test(name)) return '运行命令';
  if (compact.includes('search')) return '查询资料';
  if (compact.includes('fetch') || compact.includes('browser')) return '浏览网页';
  if (compact.includes('read_file') || compact.includes('list_dir') || compact.includes('grep')) return '读取资料';
  if (compact.includes('write') || compact.includes('edit') || compact.includes('patch')) return '写入文件';
  if (source === 'mcp') return '查询外部数据';
  if (source === 'web') return '查询资料';
  if (source === 'browser') return '浏览网页';
  if (source === 'shell') return '运行命令';
  if (source === 'file') return '处理文件';
  if (source === 'media') return '生成内容';
  return '执行步骤';
}

function fileActionTitle(edit: UIFileEdit): string {
  if (edit.operation === 'delete') return '删除文件';
  const tool = edit.tool.toLowerCase();
  if (tool.includes('edit') || tool.includes('patch')) return '编辑文件';
  return '写入文件';
}

function mediaDetail(evidence: ActivityEvidence[]): string {
  if (evidence.length === 1) return evidence[0].caption || '已生成媒体内容';
  return `已生成 ${evidence.length} 项内容`;
}

function compactTraceDetail(line: string): string {
  const compact = line.replace(/\s+/g, ' ').trim();
  if (!compact) return '正在处理任务';
  return compact.length > 120 ? `${compact.slice(0, 119)}…` : compact;
}

function displaySubjectDetail(subject: unknown, fallback: string): string {
  const cleanSubject = cleanString(subject);
  const generic = fallback === '正在处理任务'
    || fallback === '步骤已完成'
    || fallback === '当前步骤未完成';
  return cleanSubject && generic ? cleanSubject : fallback;
}

function traceLines(message: Message): string[] {
  if (message.traces?.length) return message.traces.filter((line) => line.trim());
  if (typeof message.content === 'string' && message.content.trim()) return [message.content];
  return [];
}

function hasKeys(value: Record<string, unknown> | undefined): boolean {
  return !!value && Object.keys(value).length > 0;
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
