import type { Message } from '@/types';
import type { ToolProgressEvent, UIFileEdit } from '@/core/types';

const FILE_EDIT_TOOL_NAMES = new Set(['write_file', 'edit_file', 'apply_patch']);

function eventToolName(event: ToolProgressEvent): string {
  const fn = (event as { function?: { name?: unknown } }).function;
  return typeof event.name === 'string'
    ? event.name
    : typeof fn?.name === 'string'
      ? fn.name
      : '';
}

export function formatToolCallTrace(call: unknown): string | null {
  if (!call || typeof call !== 'object') return null;
  const item = call as {
    name?: unknown;
    arguments?: unknown;
    function?: { name?: unknown; arguments?: unknown };
  };
  const name =
    typeof item.function?.name === 'string'
      ? item.function.name
      : typeof item.name === 'string'
        ? item.name
        : '';
  if (!name) return null;
  const args = item.function?.arguments ?? item.arguments;
  if (typeof args === 'string' && args.trim()) return `${name}(${args})`;
  if (args && typeof args === 'object') return `${name}(${JSON.stringify(args)})`;
  return `${name}()`;
}

const VALID_PHASES = new Set(['start', 'end', 'error']);
const PHASE_RANK: Record<string, number> = { start: 1, end: 2, error: 3 };

export function normalizeToolProgressEvents(events: unknown): ToolProgressEvent[] {
  if (!Array.isArray(events)) return [];
  const out: ToolProgressEvent[] = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const record = event as ToolProgressEvent;
    const phase = record.phase;
    if (!(phase && typeof phase === 'string' && VALID_PHASES.has(phase))) continue;
    const name = typeof record.name === 'string' ? record.name : '';
    const functionName =
      typeof (record as { function?: { name?: unknown } }).function?.name === 'string'
        ? String((record as { function?: { name?: unknown } }).function?.name)
        : '';
    if (!name && !functionName) continue;
    out.push(record);
  }
  return out;
}

function toolEventKey(event: ToolProgressEvent): string {
  if (event.call_id) return `call:${event.call_id}`;
  return formatToolCallTrace(event) ?? JSON.stringify(event);
}

export function mergeToolProgressEvents(
  previous: ToolProgressEvent[] | undefined,
  incoming: ToolProgressEvent[],
): ToolProgressEvent[] {
  if (!previous?.length) return incoming;
  if (!incoming.length) return previous;
  const next = [...previous];
  const indexByKey = new Map(next.map((event, index) => [toolEventKey(event), index]));
  for (const event of incoming) {
    const key = toolEventKey(event);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, next.length);
      next.push(event);
      continue;
    }
    const existing = next[existingIndex];
    const incomingRank = PHASE_RANK[String(event.phase)] ?? 0;
    const existingRank = PHASE_RANK[String(existing.phase)] ?? 0;
    next[existingIndex] = incomingRank >= existingRank ? { ...existing, ...event } : existing;
  }
  return next;
}

export function toolTraceLinesFromEvents(events: unknown): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const event of normalizeToolProgressEvents(events)) {
    const callId = event.call_id;
    if (callId) {
      if (seen.has(callId)) continue;
      seen.add(callId);
    }
    const line = formatToolCallTrace(event);
    if (!line) continue;
    lines.push(line);
  }
  return lines;
}

export function mergeUniqueToolTraceLines(
  previousTraces: string[],
  lines: string[],
): { traces: string[]; added: boolean } {
  const seen = new Set(previousTraces);
  const traces = [...previousTraces];
  let added = false;
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    traces.push(line);
    added = true;
  }
  return { traces, added };
}

export function fileEditKey(edit: Pick<UIFileEdit, 'call_id' | 'tool' | 'path'>): string {
  if (edit.call_id) return `${edit.call_id}|${edit.tool}`;
  return `${edit.tool}|${edit.path}`;
}

export function toolEventFileEditKey(event: ToolProgressEvent): string | null {
  const name = eventToolName(event);
  const callId = typeof event.call_id === 'string' ? event.call_id : '';
  if (!name || !callId || !FILE_EDIT_TOOL_NAMES.has(name)) return null;
  return `${callId}|${name}`;
}

function traceLineForEvent(event: ToolProgressEvent): string {
  const name = eventToolName(event) || 'tool';
  if (event.phase === 'start') return `Using ${name}`;
  if (event.phase === 'error') return `${name} failed`;
  if (event.phase === 'end') return `${name} completed`;
  return name;
}

export function stripCoveredFileEditToolHints(message: Message, edits: UIFileEdit[]): Message {
  if (!message.toolEvents?.length || !edits.length) return message;

  const incomingKeys = new Set(edits.map(fileEditKey));
  const removedLines = new Set<string>();
  const keptEvents: ToolProgressEvent[] = [];
  let changed = false;

  for (const event of message.toolEvents) {
    const key = toolEventFileEditKey(event);
    if (key && incomingKeys.has(key)) {
      changed = true;
      removedLines.add(traceLineForEvent(event));
      continue;
    }
    keptEvents.push(event);
  }

  if (!changed) return message;

  const previousTraces = message.traces?.length
    ? message.traces
    : typeof message.content === 'string' && message.content
      ? [message.content]
      : [];
  const traces = previousTraces.filter((line) => !removedLines.has(line));

  return {
    ...message,
    traces,
    content: traces[traces.length - 1] ?? '',
    toolEvents: keptEvents.length ? keptEvents : undefined,
  };
}

export function filterCoveredFileEditToolEvents(messages: Message[], events: ToolProgressEvent[]): ToolProgressEvent[] {
  if (!events.length) return events;
  const coveredKeys = new Set<string>();
  for (const message of messages) {
    for (const edit of message.fileEdits ?? []) {
      coveredKeys.add(fileEditKey(edit));
    }
  }
  if (coveredKeys.size === 0) return events;
  return events.filter((event) => {
    const key = toolEventFileEditKey(event);
    return !key || !coveredKeys.has(key);
  });
}

export function mergeFileEdits(existing: UIFileEdit[] | undefined, incoming: UIFileEdit[]): UIFileEdit[] {
  const out = [...(existing ?? [])];
  const indexByKey = new Map(out.map((edit, index) => [fileEditKey(edit), index]));
  for (const edit of incoming) {
    const key = fileEditKey(edit);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, out.length);
      out.push(edit);
      continue;
    }
    out[existingIndex] = { ...out[existingIndex], ...edit };
  }
  return out;
}

function hasVisibleTracePayload(message: Message): boolean {
  if (message.kind !== 'trace' && message.role !== 'tool') return true;
  if (message.toolEvents?.length) return true;
  if (message.fileEdits?.length) return true;
  if (message.mediaAttachments?.length) return true;
  if (message.narration?.trim()) return true;
  return typeof message.content === 'string' && message.content.trim().length > 0;
}

export function normalizeFileEditToolTraces(messages: Message[]): Message[] {
  let out: Message[] = [];
  for (const message of messages) {
    if (!message.fileEdits?.length) {
      out.push(message);
      continue;
    }

    out = out.map((existing) => stripCoveredFileEditToolHints(existing, message.fileEdits!));
    const incomingKeys = new Set(message.fileEdits.map(fileEditKey));
    const targetIndex = out.findIndex((existing) =>
      existing.kind === 'trace'
      && existing.loopId === message.loopId
      && existing.fileEdits?.some((edit) => incomingKeys.has(fileEditKey(edit)))
    );

    if (targetIndex !== -1) {
      out[targetIndex] = {
        ...out[targetIndex],
        fileEdits: mergeFileEdits(out[targetIndex].fileEdits, message.fileEdits),
      };
    } else {
      out.push(message);
    }
  }

  return out.filter(hasVisibleTracePayload);
}
