import type { Message } from '@/types';

export type ChatDisplayUnit =
  | { type: 'activity'; messages: Message[] }
  | { type: 'message'; message: Message };

export function isReasoningOnlyAssistant(message: Message): boolean {
  return (
    message.role === 'assistant'
    && message.kind !== 'trace'
    && typeof message.content === 'string'
    && message.content.trim().length === 0
    && (!!message.thinking?.trim() || !!message.reasoningStreaming || !!message.isStreaming)
  );
}

function isAgentActivityMember(message: Message): boolean {
  return isReasoningOnlyAssistant(message) || message.kind === 'trace' || message.role === 'tool';
}

function assistantHasInlineReasoning(message: Message): boolean {
  return (
    message.role === 'assistant'
    && message.kind !== 'trace'
    && typeof message.content === 'string'
    && message.content.trim().length > 0
    && (!!message.thinking?.trim() || !!message.reasoningStreaming)
  );
}

function isEmptyAssistantPlaceholder(message: Message): boolean {
  return (
    message.role === 'assistant'
    && message.kind !== 'trace'
    && typeof message.content === 'string'
    && message.content.trim().length === 0
    && !message.thinking?.trim()
    && !message.reasoningStreaming
    && !message.mediaAttachments?.length
  );
}

function reasoningOnlyMessageFromAnswer(message: Message): Message {
  return {
    ...message,
    id: `${message.id}-reasoning`,
    content: '',
    isStreaming: message.reasoningStreaming || message.isStreaming,
    toolCalls: undefined,
    mediaAttachments: undefined,
  };
}

function stripInlineReasoning(message: Message): Message {
  return {
    ...message,
    thinking: undefined,
    reasoningStreaming: undefined,
  };
}

function isFileEditActivityMessage(message: Message): boolean {
  return message.kind === 'trace' && !!message.fileEdits?.length;
}

function pushActivityUnits(units: ChatDisplayUnit[], activityMessages: Message[]) {
  let runMessages: Message[] = [];
  let runBucket: 'file' | 'other' | undefined;
  let runSegmentId: string | undefined;

  const flushRun = () => {
    if (!runMessages.length) return;
    units.push({ type: 'activity', messages: runMessages });
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

export function normalizeActivityTimeline(messages: Message[]): ChatDisplayUnit[] {
  const units: ChatDisplayUnit[] = [];
  let turnMessages: Message[] = [];

  const flushTurn = () => {
    if (!turnMessages.length) return;
    let activityMessages: Message[] = [];

    const flushActivityMessages = () => {
      if (!activityMessages.length) return;
      pushActivityUnits(units, activityMessages);
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
        continue;
      }

      flushActivityMessages();
      units.push({ type: 'message', message });
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
