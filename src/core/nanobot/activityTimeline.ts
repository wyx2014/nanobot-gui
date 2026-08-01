import type { Message, MessageMediaAttachment } from '@/types';
import type { ToolProgressEvent } from '@/core/types';

export type ActivityItemType = 'reasoning' | 'narration' | 'tool' | 'cli' | 'mcp' | 'file_edit' | 'media';
export type ActivityStepStatus = 'pending' | 'running' | 'done' | 'error';
export type ActivityStepSource = 'reasoning' | 'tool' | 'web' | 'browser' | 'shell' | 'mcp' | 'file' | 'media';

export interface ActivityItem {
  type: ActivityItemType;
  message: Message;
}

export interface ActivityEvidence {
  id: string;
  attachment: MessageMediaAttachment;
  caption?: string;
  source: ActivityStepSource;
}

export interface ActivityStepItem {
  id: string;
  label: string;
  detail?: string;
  status: ActivityStepStatus;
  source: ActivityStepSource;
  preview?: ActivityEvidence[];
  error?: string;
}

export interface ActivityGroup {
  id: string;
  title: string;
  source: ActivityStepSource;
  steps: ActivityStepItem[];
}

export type ChatDisplayUnit =
  | {
      type: 'activity';
      messages: Message[];
      items: ActivityItem[];
      turnLatencyMs?: number;
      turnCompletedAt?: number;
    }
  | { type: 'message'; message: Message };

export interface ActivityTimelineProjector {
  project(messages: Message[]): ChatDisplayUnit[];
}

export function isReasoningOnlyAssistant(message: Message): boolean {
  if (message.role !== 'assistant' || message.kind === 'trace') return false;
  if (typeof message.content === 'string' && message.content.trim().length > 0) return false;
  if (Array.isArray(message.content)) {
    const textBlock = message.content.find((block) => block.type === 'text');
    if (textBlock?.type === 'text' && textBlock.text.trim().length > 0) return false;
  }
  return !!(
    message.thinking?.length
    || message.reasoningStreaming
    || message.narration?.trim()
    || message.narrationStreaming
    || message.isStreaming
  );
}

export function isAgentActivityMember(message: Message): boolean {
  return isReasoningOnlyAssistant(message) || message.kind === 'trace';
}

export function normalizeActivityTimeline(messages: Message[]): ChatDisplayUnit[] {
  const units: ChatDisplayUnit[] = [];
  let turnMessages: Message[] = [];

  const flushTurn = () => {
    if (turnMessages.length === 0) return;

    const visibleMessages: Message[] = [];
    const turnUnits: ChatDisplayUnit[] = [];
    let activityMessages: Message[] = [];
    const orderedTurnMessages = placeTrailingTerminalProgressBeforeFinalReply(turnMessages);

    const flushActivity = () => {
      if (activityMessages.length === 0) return;
      turnUnits.push({
        type: 'activity',
        messages: activityMessages,
        items: activityMessages.flatMap(activityItemsForMessage),
      });
      activityMessages = [];
    };

    for (const message of orderedTurnMessages) {
      if (isEmptyAssistantPlaceholder(message)) continue;
      if (isAgentActivityMember(message)) {
        activityMessages.push(message);
        continue;
      }

      if (assistantHasInlineReasoning(message)) {
        activityMessages.push(reasoningOnlyMessageFromAnswer(message));
        flushActivity();
        const visibleMessage = stripInlineReasoning(message);
        visibleMessages.push(visibleMessage);
        turnUnits.push({ type: 'message', message: visibleMessage });
        continue;
      }

      flushActivity();
      visibleMessages.push(message);
      turnUnits.push({ type: 'message', message });
    }
    flushActivity();

    const lastActivityIndex = findLastActivityIndex(turnUnits);
    if (lastActivityIndex >= 0) {
      const activityUnit = turnUnits[lastActivityIndex];
      if (activityUnit.type === 'activity') {
        turnUnits[lastActivityIndex] = {
          ...activityUnit,
          turnLatencyMs: activityTurnLatencyMs(
            turnUnits.flatMap((unit) => unit.type === 'activity' ? unit.messages : []),
            visibleMessages,
          ),
          turnCompletedAt: activityTurnCompletedAt(
            turnUnits.flatMap((unit) => unit.type === 'activity' ? unit.messages : []),
            visibleMessages,
          ),
        };
      }
    }

    units.push(...turnUnits);
    turnMessages = [];
  };

  for (const message of messages) {
    if (message.role === 'user') {
      flushTurn();
      units.push({ type: 'message', message });
      continue;
    }

    turnMessages.push(message);
  }

  flushTurn();
  return units;
}

/**
 * Runtime terminalization is deliberately journal-first. That means the
 * canonical terminal plan snapshot can be persisted a few milliseconds after
 * the final assistant payload. It still belongs to the turn's ToolStep, not
 * below the answer body.
 *
 * Only move a trailing activity-only suffix when it contains an explicitly
 * terminal plan. Intermediate answer -> tool -> answer sequences retain their
 * original order.
 */
/**
 * Runtime terminalization is deliberately journal-first: the canonical
 * terminal plan snapshot — and any late tool finish frames — can be persisted
 * a few milliseconds after the final assistant payload. They still belong to
 * the turn's ToolStep, not below the answer body.
 *
 * Any trailing activity-only suffix after the last real answer is therefore
 * lifted above that answer. Intermediate answer -> tool -> answer sequences
 * keep their original order (their activity is not a trailing suffix).
 */
function placeTrailingTerminalProgressBeforeFinalReply(messages: Message[]): Message[] {
  let finalReplyIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.role === 'assistant'
      && message.kind !== 'trace'
      && !isEmptyAssistantPlaceholder(message)
      && !isReasoningOnlyAssistant(message)
    ) {
      finalReplyIndex = index;
      break;
    }
  }
  if (finalReplyIndex < 0 || finalReplyIndex === messages.length - 1) return messages;

  const suffix = messages.slice(finalReplyIndex + 1);
  const activityOnly = suffix.every((message) => (
    isAgentActivityMember(message) || isEmptyAssistantPlaceholder(message)
  ));
  if (!activityOnly) return messages;

  return [
    ...messages.slice(0, finalReplyIndex),
    ...suffix,
    messages[finalReplyIndex],
  ];
}

function findLastActivityIndex(units: ChatDisplayUnit[]): number {
  for (let index = units.length - 1; index >= 0; index -= 1) {
    if (units[index].type === 'activity') return index;
  }
  return -1;
}

/**
 * Incremental projection for a live conversation.
 *
 * Streaming frames only mutate the current assistant turn. Completed turns
 * are kept by reference and never walked again; a complete rebuild occurs
 * only when a new user message starts the next turn or history is replaced.
 */
export function createActivityTimelineProjector(): ActivityTimelineProjector {
  let committedMessages: Message[] = [];
  let committedUnits: ChatDisplayUnit[] = [];

  return {
    project(messages: Message[]): ChatDisplayUnit[] {
      const boundary = committedTurnBoundary(messages);
      const nextCommitted = messages.slice(0, boundary);
      if (!sameMessageReferences(committedMessages, nextCommitted)) {
        committedMessages = nextCommitted;
        committedUnits = normalizeActivityTimeline(nextCommitted);
      }
      return committedUnits.concat(normalizeActivityTimeline(messages.slice(boundary)));
    },
  };
}

function committedTurnBoundary(messages: Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index + 1;
  }
  return 0;
}

function sameMessageReferences(left: Message[], right: Message[]): boolean {
  return left.length === right.length && left.every((message, index) => message === right[index]);
}

/** Empty assistant placeholder rows are created by the stream hook for tool events
 * that arrive before the first delta. Skip them in the timeline — the tool events
 * themselves are captured by the activity group. */
function isEmptyAssistantPlaceholder(message: Message): boolean {
  if (message.role !== 'assistant' || message.kind === 'trace') return false;
  if (isAgentActivityMember(message)) return false;
  const text = typeof message.content === 'string' ? message.content.trim() : '';
  if (text.length > 0) return false;
  if (Array.isArray(message.content)) {
    const textBlock = message.content.find((block) => block.type === 'text');
    if (textBlock?.type === 'text' && textBlock.text.trim().length > 0) return false;
  }
  if (message.thinking?.trim()) return false;
  if (message.reasoningStreaming) return false;
  if (message.mediaAttachments?.length) return false;
  return true;
}

function assistantHasInlineReasoning(message: Message): boolean {
  if (message.role !== 'assistant' || message.kind === 'trace') return false;
  const hasActivity = !!(
    message.thinking?.trim()
    || message.reasoningStreaming
    || message.narration?.trim()
    || message.narrationStreaming
  );
  const text = typeof message.content === 'string' ? message.content.trim() : '';
  if (text.length === 0 && Array.isArray(message.content)) {
    const textBlock = message.content.find((block) => block.type === 'text');
    if (textBlock?.type === 'text') {
      return textBlock.text.trim().length > 0 && hasActivity;
    }
  }
  return text.length > 0 && hasActivity;
}

function reasoningOnlyMessageFromAnswer(message: Message): Message {
  return {
    id: `${message.id}-reasoning`,
    role: 'assistant',
    content: '',
    timestamp: message.timestamp,
    thinking: message.thinking,
    reasoningStreaming: message.reasoningStreaming,
    narration: message.narration,
    narrationStreaming: message.narrationStreaming,
    isStreaming: !!(message.reasoningStreaming || message.isStreaming),
    activitySegmentId: message.activitySegmentId,
    thinkingDuration: message.thinkingDuration,
    turnDurationMs: message.turnDurationMs,
    completedAt: message.completedAt,
  };
}

function stripInlineReasoning(message: Message): Message {
  return {
    ...message,
    thinking: undefined,
    reasoningStreaming: undefined,
    narration: undefined,
    narrationStreaming: undefined,
  };
}

function activityItemsForMessage(message: Message): ActivityItem[] {
  const items: ActivityItem[] = [];
  if (isReasoningOnlyAssistant(message)) {
    if (message.thinking?.trim() || message.reasoningStreaming) {
      items.push({ type: 'reasoning', message });
    }
    if (message.narration?.trim() || message.narrationStreaming) {
      items.push({ type: 'narration', message });
    }
    return items;
  }
  if (message.kind !== 'trace') return [];

  if (message.narration?.trim() || message.narrationStreaming) {
    items.push({ type: 'narration', message });
  }
  if (message.fileEdits?.length) {
    items.push({ type: 'file_edit', message });
  }
  for (const event of message.toolEvents ?? []) {
    const name = String(event.name ?? '').toLowerCase();
    if (name === 'run_cli_app') {
      items.push({ type: 'cli', message });
    } else if (name === 'mcp') {
      items.push({ type: 'mcp', message });
    } else {
      items.push({ type: 'tool', message });
    }
  }
  if (items.length === 0 && (message.traces?.length || textContent(message).trim())) {
    items.push({ type: 'tool', message });
  }
  if (message.mediaAttachments?.length) {
    items.push({ type: 'media', message });
  }
  return items;
}

function textContent(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  const textBlock = message.content.find((block) => block.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

function activityTurnLatencyMs(activityMessages: Message[], visibleMessages: Message[]): number | undefined {
  for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
    const duration = visibleMessages[i].turnDurationMs;
    if (isValidLatency(duration)) return Math.round(duration);
  }
  for (let i = activityMessages.length - 1; i >= 0; i -= 1) {
    const duration = activityMessages[i].turnDurationMs;
    if (isValidLatency(duration)) return Math.round(duration);
  }
  return undefined;
}

function activityTurnCompletedAt(
  activityMessages: Message[],
  visibleMessages: Message[],
): number | undefined {
  for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
    const completedAt = visibleMessages[i].completedAt;
    if (isValidTimestamp(completedAt)) return completedAt;
  }
  for (let i = activityMessages.length - 1; i >= 0; i -= 1) {
    const completedAt = activityMessages[i].completedAt;
    if (isValidTimestamp(completedAt)) return completedAt;
  }
  return undefined;
}

function isValidLatency(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function activityEvidenceFromToolEvent(event: ToolProgressEvent): ActivityEvidence[] {
  const source = activitySourceFromToolName(toolEventName(event));
  const evidence: ActivityEvidence[] = [];
  const extras = [
    ...unknownList((event as { embeds?: unknown }).embeds),
    ...unknownList((event as { files?: unknown }).files),
  ];
  extras.forEach((value, index) => {
    const attachment = mediaAttachmentFromUnknown(value);
    if (!attachment) return;
    evidence.push({
      id: `${event.call_id || toolEventName(event) || 'tool'}:${index}:${attachment.url || attachment.path || attachment.name || attachment.kind}`,
      attachment,
      caption: attachment.name,
      source,
    });
  });
  return evidence;
}

export function activityEvidenceFromMessageMedia(message: Message): ActivityEvidence[] {
  return (message.mediaAttachments ?? []).map((attachment, index) => ({
    id: `${message.id}:media:${index}:${attachment.url || attachment.path || attachment.name || attachment.kind}`,
    attachment,
    caption: attachment.name,
    source: 'media',
  }));
}

function unknownList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toolEventName(event: ToolProgressEvent): string {
  const fn = (event as { function?: { name?: unknown } }).function;
  return typeof fn?.name === 'string'
    ? fn.name
    : typeof event.name === 'string'
      ? event.name
      : '';
}

export function activitySourceFromToolName(name: string): ActivityStepSource {
  const compact = name.toLowerCase();
  if (compact.includes('browser') || compact.includes('screenshot')) return 'browser';
  if (compact.includes('web') || compact.includes('search') || compact.includes('fetch') || compact.includes('read')) return 'web';
  if (compact.includes('exec') || compact.includes('shell') || compact.includes('cli') || compact.includes('command')) return 'shell';
  if (compact.startsWith('mcp_') || compact === 'mcp') return 'mcp';
  if (compact.includes('file') || compact.includes('patch') || compact.includes('write') || compact.includes('edit')) return 'file';
  if (compact.includes('image') || compact.includes('video') || compact.includes('media')) return 'media';
  return 'tool';
}

function mediaAttachmentFromUnknown(value: unknown): MessageMediaAttachment | null {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    return normalizeMediaAttachment({ url: looksLikeUrl(text) ? text : undefined, path: looksLikeUrl(text) ? undefined : text, name: baseName(text) });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const url = stringField(record, ['url', 'href', 'src', 'uri', 'signed_url', 'thumbnail_url']);
  const path = stringField(record, ['path', 'absolute_path', 'file', 'filename']);
  const name = stringField(record, ['name', 'filename', 'title', 'label']) ?? baseName(url ?? path ?? '');
  const kind = mediaKindFromRecord(record, url, name);
  const mimeType = stringField(record, ['mime_type', 'mimeType', 'content_type']);
  const downloadUrl = stringField(record, ['download_url', 'downloadUrl']);
  const id = stringField(record, ['id', 'artifact_id']);
  const size = typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : undefined;
  return normalizeMediaAttachment({ url, path, name, kind, mimeType, downloadUrl, id, size });
}

function normalizeMediaAttachment(attachment: MessageMediaAttachment): MessageMediaAttachment {
  return {
    ...attachment,
    name: attachment.name ?? baseName(attachment.url ?? attachment.path ?? ''),
    kind: attachment.kind ?? mediaKindFromName(attachment.name ?? attachment.url ?? attachment.path ?? ''),
  };
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function mediaKindFromRecord(record: Record<string, unknown>, url?: string, name?: string): MessageMediaAttachment['kind'] | undefined {
  const raw = stringField(record, ['kind', 'type', 'mime', 'mime_type', 'content_type'])?.toLowerCase() ?? '';
  if (raw.includes('image') || raw.includes('screenshot')) return 'image';
  if (raw.includes('video') || raw.includes('mp4') || raw.includes('quicktime')) return 'video';
  if (raw.includes('file') || raw.includes('document')) return 'file';
  return mediaKindFromName(name ?? url ?? '');
}

function mediaKindFromName(name: string): MessageMediaAttachment['kind'] {
  const ext = name.split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  return 'file';
}

function looksLikeUrl(value: string): boolean {
  return /^(https?:|data:|\/api\/|blob:)/i.test(value);
}

function baseName(value: string): string | undefined {
  const clean = value.split(/[?#]/, 1)[0] ?? '';
  const last = clean.split(/[\\/]/).filter(Boolean).pop();
  return last || undefined;
}
