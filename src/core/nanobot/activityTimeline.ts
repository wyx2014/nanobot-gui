import type { Message, MessageMediaAttachment } from '@/types';
import type { ToolProgressEvent } from '@/core/types';

export type ActivityItemType = 'reasoning' | 'tool' | 'cli' | 'mcp' | 'file_edit' | 'media';
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
  | { type: 'activity'; messages: Message[]; items: ActivityItem[]; turnLatencyMs?: number }
  | { type: 'message'; message: Message };

export function isReasoningOnlyAssistant(message: Message): boolean {
  if (message.role !== 'assistant' || message.kind === 'trace') return false;
  if (typeof message.content === 'string' && message.content.trim().length > 0) return false;
  if (Array.isArray(message.content)) {
    const textBlock = message.content.find((block) => block.type === 'text');
    if (textBlock?.type === 'text' && textBlock.text.trim().length > 0) return false;
  }
  return !!(message.thinking?.length || message.reasoningStreaming || message.isStreaming);
}

export function isAgentActivityMember(message: Message): boolean {
  return isReasoningOnlyAssistant(message) || message.kind === 'trace';
}

export function normalizeActivityTimeline(messages: Message[]): ChatDisplayUnit[] {
  const units: ChatDisplayUnit[] = [];
  let turnMessages: Message[] = [];

  const flushTurn = () => {
    if (turnMessages.length === 0) return;

    const visibleMessages = visibleMessagesForTurn(turnMessages);
    let visibleIndex = 0;
    let activityMessages: Message[] = [];

    const flushActivityMessages = () => {
      if (!activityMessages.length) return;
      pushActivityUnits(units, activityMessages, visibleMessages.slice(visibleIndex));
      activityMessages = [];
    };

    for (const message of turnMessages) {
      if (isEmptyAssistantPlaceholder(message)) {
        continue;
      }

      if (isAgentActivityMember(message)) {
        activityMessages.push(message);
        continue;
      }

      if (assistantHasInlineReasoning(message)) {
        activityMessages.push(reasoningOnlyMessageFromAnswer(message));
        flushActivityMessages();
        units.push({ type: 'message', message: stripInlineReasoning(message) });
        visibleIndex += 1;
        continue;
      }

      flushActivityMessages();
      units.push({ type: 'message', message });
      visibleIndex += 1;
    }

    flushActivityMessages();
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

function visibleMessagesForTurn(messages: Message[]): Message[] {
  const visibleMessages: Message[] = [];
  for (const message of messages) {
    if (isAgentActivityMember(message)) continue;
    visibleMessages.push(assistantHasInlineReasoning(message) ? stripInlineReasoning(message) : message);
  }
  return visibleMessages;
}

function pushActivityUnits(units: ChatDisplayUnit[], activityMessages: Message[], visibleMessages: Message[]) {
  let runMessages: Message[] = [];
  let runBucket: 'file' | 'other' | undefined;
  let runSegmentId: string | undefined;

  const flushRun = () => {
    if (!runMessages.length) return;
    units.push({
      type: 'activity',
      messages: runMessages,
      items: runMessages.flatMap(activityItemsForMessage),
      turnLatencyMs: activityTurnLatencyMs(runMessages, visibleMessages),
    });
    runMessages = [];
    runBucket = undefined;
    runSegmentId = undefined;
  };

  for (const message of activityMessages) {
    const bucket = isFileEditActivityMessage(message) ? 'file' : 'other';
    const segmentId = message.activitySegmentId;
    const segmentChanged =
      bucket === 'file'
      && runBucket === 'file'
      && !!runSegmentId
      && !!segmentId
      && runSegmentId !== segmentId;
    if ((runBucket && bucket !== runBucket) || segmentChanged) {
      flushRun();
    }
    runBucket = bucket;
    if (segmentId) runSegmentId = segmentId;
    runMessages.push(message);
  }

  flushRun();
}

function isFileEditActivityMessage(message: Message): boolean {
  return message.kind === 'trace' && !!message.fileEdits?.length;
}

/** Empty assistant placeholder rows are created by chatBridge.ts for tool events
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
  const text = typeof message.content === 'string' ? message.content.trim() : '';
  if (text.length === 0 && Array.isArray(message.content)) {
    const textBlock = message.content.find((block) => block.type === 'text');
    if (textBlock?.type === 'text') {
      return textBlock.text.trim().length > 0 && (!!message.thinking?.trim() || !!message.reasoningStreaming);
    }
  }
  return text.length > 0 && (!!message.thinking?.trim() || !!message.reasoningStreaming);
}

function reasoningOnlyMessageFromAnswer(message: Message): Message {
  return {
    id: `${message.id}-reasoning`,
    role: 'assistant',
    content: '',
    timestamp: message.timestamp,
    thinking: message.thinking,
    reasoningStreaming: message.reasoningStreaming,
    isStreaming: !!(message.reasoningStreaming || message.isStreaming),
    activitySegmentId: message.activitySegmentId,
    thinkingDuration: message.thinkingDuration,
  };
}

function stripInlineReasoning(message: Message): Message {
  const next = { ...message };
  delete (next as any).thinking;
  delete (next as any).reasoningStreaming;
  return next;
}

function activityItemsForMessage(message: Message): ActivityItem[] {
  if (isReasoningOnlyAssistant(message)) {
    return [{ type: 'reasoning', message }];
  }
  if (message.kind !== 'trace') return [];

  const items: ActivityItem[] = [];
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
  for (let i = activityMessages.length - 1; i >= 0; i -= 1) {
    const latency = activityMessages[i].thinkingDuration;
    if (isValidLatency(latency)) return Math.round(latency * 1000);
  }
  for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
    const latency = visibleMessages[i].thinkingDuration;
    if (isValidLatency(latency)) return Math.round(latency * 1000);
  }
  return undefined;
}

function isValidLatency(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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
  return normalizeMediaAttachment({ url, path, name, kind });
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
