import type { ImageAttachment, MessageContent, MessageMediaAttachment, ToolCall } from '@/types';
import type {
  InboundEvent,
  OutboundCliAppMention,
  OutboundImageGeneration,
  OutboundMcpPresetMention,
  OutboundMedia,
  ToolProgressEvent,
  UIFileEdit,
  WorkspaceScopePayload,
} from '@/core/types';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTaskExecutionStore } from '@/stores/taskExecutionStore';
import { notifyTaskError } from '@/utils/notifications';
import { getNanobotClient, normalizeToolProgressEvents } from '@/core/nanobotClient';
import { snapshotExecutionSteps } from './executionSnapshot';
import {
  filterCoveredFileEditToolEvents,
  fileEditKey,
  mergeFileEdits,
  stripCoveredFileEditToolHints,
} from './toolTraceMerge';

export interface NanobotSendOptions {
  images?: ImageAttachment[];
  loopId?: string;
  imageGeneration?: OutboundImageGeneration;
  cliApps?: OutboundCliAppMention[];
  mcpPresets?: OutboundMcpPresetMention[];
  workspaceScope?: WorkspaceScopePayload | null;
}

type PendingStreamEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'reasoning'; text: string };

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function persistExecutionSnapshot(conversationId: string, loopId: string): void {
  const store = useTaskExecutionStore.getState();
  const exec = store.getExecutionByLoopId(loopId);
  if (exec && exec.steps.length > 0) {
    useChatStore.getState().setExecutionStepsSnapshot(conversationId, loopId, snapshotExecutionSteps(exec.steps));
    store.evictExecution(exec.id);
  }
}

function toolName(event: ToolProgressEvent): string {
  const fn = (event as { function?: { name?: unknown } }).function;
  return typeof event.name === 'string'
    ? event.name
    : typeof fn?.name === 'string'
      ? fn.name
      : 'tool';
}

function toolArgs(event: ToolProgressEvent): Record<string, unknown> {
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

function toolResult(event: ToolProgressEvent): string {
  if (typeof event.result === 'string') return event.result;
  if (event.result !== undefined && event.result !== null) return JSON.stringify(event.result);
  if (event.error !== undefined && event.error !== null) return String(event.error);
  return '';
}

function ensureStep(
  execId: string,
  callId: string,
  name: string,
  args: Record<string, unknown>,
): void {
  const taskExecutionStore = useTaskExecutionStore.getState();
  if (taskExecutionStore.findStep(execId, callId)) return;
  taskExecutionStore.addStep(execId, {
    id: callId,
    executionId: execId,
    type: 'tool',
    label: name,
    status: 'running',
    toolName: name,
    startTime: Date.now(),
    toolInput: args,
    source: 'agent',
    detailBlocks: [],
  });
}

function applyToolEvents(
  conversationId: string | null,
  assistantMsgId: string | null,
  execId: string,
  rawEvents: unknown,
): void {
  const chatStore = conversationId ? useChatStore.getState() : null;
  const taskExecutionStore = useTaskExecutionStore.getState();
  const events = normalizeToolProgressEvents(rawEvents);

  for (const event of events) {
    const callId = event.call_id;
    if (!callId) continue;

    const name = toolName(event);
    const args = toolArgs(event);

    if (event.phase === 'start') {
      if (chatStore && conversationId && assistantMsgId) {
        const toolCall: ToolCall = {
          id: callId,
          name,
          input: args,
          isExecuting: true,
          startTime: Date.now(),
        };
        chatStore.addToolCall(conversationId, assistantMsgId, toolCall);
      }
      ensureStep(execId, callId, name, args);
      continue;
    }

    if (event.phase === 'end' || event.phase === 'error') {
      const isError = event.phase === 'error';
      const result = toolResult(event);
      ensureStep(execId, callId, name, args);
      if (chatStore && conversationId && assistantMsgId) {
        chatStore.updateToolCall(conversationId, assistantMsgId, callId, result, undefined, isError);
      }
      taskExecutionStore.setStepResult(execId, callId, result);
      if (isError) {
        taskExecutionStore.setStepError(execId, callId, result || 'Tool error');
      }
    }
  }
}

function traceLineForEvent(event: ToolProgressEvent): string {
  const name = toolName(event);
  if (event.phase === 'start') return `Using ${name}`;
  if (event.phase === 'error') return `${name} failed`;
  if (event.phase === 'end') return `${name} completed`;
  return name;
}

function addToolTraceMessage(
  conversationId: string,
  loopId: string,
  rawText: string | undefined,
  rawEvents: unknown,
): void {
  const chatStore = useChatStore.getState();
  const currentMessages = chatStore.conversations[conversationId]?.messages ?? [];
  const events = filterCoveredFileEditToolEvents(currentMessages, normalizeToolProgressEvents(rawEvents));
  const traces = events.length > 0
    ? events.map(traceLineForEvent)
    : rawText
      ? [rawText]
      : [];
  if (traces.length === 0 && events.length === 0) return;
  chatStore.addMessage(conversationId, {
    id: generateId(),
    role: 'tool',
    kind: 'trace',
    content: traces[traces.length - 1] ?? '',
    traces,
    toolEvents: events,
    timestamp: Date.now(),
    loopId,
  });
}

function applyFileEdits(execId: string, edits: UIFileEdit[]): void {
  const taskExecutionStore = useTaskExecutionStore.getState();
  for (const edit of edits) {
    if (!edit.path) continue;
    const stepId = edit.call_id || `file_edit:${edit.path}`;
    if (!taskExecutionStore.findStep(execId, stepId)) {
      taskExecutionStore.addStep(execId, {
        id: stepId,
        executionId: execId,
        type: 'tool',
        label: edit.tool || 'file_edit',
        status: edit.phase === 'error' || edit.status === 'error' ? 'error' : 'running',
        toolName: edit.tool || 'file_edit',
        startTime: Date.now(),
        toolInput: { path: edit.path },
        source: 'agent',
        detailBlocks: [],
      });
    }
    taskExecutionStore.addDetailBlock(execId, stepId, {
      id: `edit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      stepId,
      type: 'diff',
      label: `${edit.operation === 'delete' ? 'Deleted' : 'Edited'} ${edit.path}`,
      content: `+${edit.added ?? 0} -${edit.deleted ?? 0} lines`,
      isTruncated: false,
      isExpanded: false,
    });
    if (edit.phase === 'end' || edit.status === 'done') {
      taskExecutionStore.setStepResult(execId, stepId, 'done');
    } else if (edit.phase === 'error' || edit.status === 'error') {
      taskExecutionStore.setStepError(execId, stepId, edit.error || 'File edit failed');
    }
  }
}

function addFileEditTraceMessage(
  conversationId: string,
  loopId: string,
  edits: UIFileEdit[],
): void {
  if (edits.length === 0) return;
  const incomingKeys = new Set(edits.map(fileEditKey));
  useChatStore.getState().updateConversationMessages(conversationId, (messages) => {
    const stripped = messages.map((message) => stripCoveredFileEditToolHints(message, edits));
    const targetIndex = stripped.findIndex((message) =>
      message.kind === 'trace'
      && message.loopId === loopId
      && message.fileEdits?.some((edit) => incomingKeys.has(fileEditKey(edit)))
    );

    if (targetIndex !== -1) {
      return stripped.map((message, index) => index === targetIndex
        ? {
            ...message,
            fileEdits: mergeFileEdits(message.fileEdits, edits),
            activitySegmentId: message.activitySegmentId,
          }
        : message);
    }

    return [
      ...stripped,
      {
        id: generateId(),
        role: 'tool',
        kind: 'trace',
        content: '',
        traces: [],
        fileEdits: edits,
        timestamp: Date.now(),
        loopId,
      },
    ];
  });
}

function mediaKindFromName(name: string): MessageMediaAttachment['kind'] {
  const ext = name.split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  return 'file';
}

function mediaFromEvent(ev: Extract<InboundEvent, { event: 'message' }>): MessageMediaAttachment[] {
  const out: MessageMediaAttachment[] = [];
  for (const path of ev.media ?? []) {
    if (!path) continue;
    out.push({
      path,
      name: path.split('/').pop() || path,
      kind: mediaKindFromName(path),
    });
  }
  for (const item of ev.media_urls ?? []) {
    if (!item?.url) continue;
    const name = item.name || item.url.split(/[/?#]/).filter(Boolean).pop() || item.url;
    out.push({
      url: item.url,
      name,
      kind: mediaKindFromName(name || item.url),
    });
  }
  return out;
}

export async function sendNanobotMessage(
  conversationId: string,
  userMessage: string,
  options?: NanobotSendOptions,
): Promise<void> {
  const settings = useSettingsStore.getState();
  const chatStore = useChatStore.getState();
  const taskExecutionStore = useTaskExecutionStore.getState();
  const loopId = options?.loopId ?? generateId();
  const cleanInput = userMessage.trim();

  try {
    if (!settings.apiKey) {
      chatStore.addMessage(conversationId, {
        id: generateId(),
        role: 'assistant',
        content: '请先在设置中配置你的 API Key。',
        timestamp: Date.now(),
        loopId,
      });
      return;
    }

    taskExecutionStore.createExecution(conversationId, loopId);
    const exec = taskExecutionStore.getExecutionByLoopId(loopId);
    if (!exec) throw new Error('Failed to create execution context');

    chatStore.clearAbortController(conversationId);
    chatStore.setConversationStatus(conversationId, 'running');
    chatStore.setAgentStatus('thinking');

    const userImages = options?.images;
    let userContent: string | MessageContent[];
    if (userImages && userImages.length > 0) {
      userContent = userImages.map((img) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mediaType, data: img.data },
      }));
      if (cleanInput) {
        userContent.push({ type: 'text' as const, text: cleanInput });
      }
    } else {
      userContent = cleanInput;
    }

    chatStore.addMessage(conversationId, {
      id: generateId(),
      role: 'user',
      content: userContent,
      timestamp: Date.now(),
      loopId,
      ...(options?.cliApps?.length ? { cliApps: options.cliApps } : {}),
      ...(options?.mcpPresets?.length ? { mcpPresets: options.mcpPresets } : {}),
    });

    const abortController = chatStore.getAbortController(conversationId);
    const signal = abortController.signal;

    await new Promise<void>((resolve, reject) => {
      const client = getNanobotClient();
      let settled = false;
      let assistantMsgId: string | null = null;
      let assistantStreamOpen = false;
      let suppressUntilTurnEnd = false;
      let thinking = '';
      let unsubscribe = () => {};
      let streamFrame: number | null = null;
      const pendingStreamEvents: PendingStreamEvent[] = [];

      const settle = (fn: () => void) => {
        if (settled) return;
        flushPendingStreamEvents();
        settled = true;
        unsubscribe();
        signal.removeEventListener('abort', handleAbort);
        fn();
      };

      const closeAssistantSegment = () => {
        assistantStreamOpen = false;
      };

      const ensureAssistantSegment = () => {
        if (assistantMsgId && assistantStreamOpen) return assistantMsgId;
        assistantMsgId = generateId();
        chatStore.addMessage(conversationId, {
          id: assistantMsgId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          loopId,
          isStreaming: true,
        });
        assistantStreamOpen = true;
        thinking = '';
        return assistantMsgId;
      };

      const ensureReasoningSegment = () => {
        if (assistantMsgId) {
          const current = useChatStore.getState().conversations[conversationId]
            ?.messages.find((message) => message.id === assistantMsgId);
          const currentText = typeof current?.content === 'string' ? current.content.trim() : '';
          if (assistantStreamOpen && !currentText) return assistantMsgId;
        }
        return ensureAssistantSegment();
      };

      const applyPendingStreamEvents = (events: PendingStreamEvent[]) => {
        for (let i = 0; i < events.length;) {
          const kind = events[i].kind;
          let text = '';
          while (i < events.length && events[i].kind === kind) {
            text += events[i].text;
            i += 1;
          }
          if (!text) continue;

          if (kind === 'delta') {
            const targetAssistantMsgId = ensureAssistantSegment();
            chatStore.setAgentStatus('streaming');
            chatStore.appendToMessage(conversationId, targetAssistantMsgId, text);
          } else {
            const targetAssistantMsgId = ensureReasoningSegment();
            thinking += text;
            chatStore.setAgentStatus('thinking');
            chatStore.updateMessageThinkingById(conversationId, targetAssistantMsgId, thinking);
          }
        }
      };

      function flushPendingStreamEvents() {
        if (streamFrame !== null) {
          window.cancelAnimationFrame(streamFrame);
          streamFrame = null;
        }
        if (pendingStreamEvents.length === 0) return;
        const events = pendingStreamEvents.splice(0);
        applyPendingStreamEvents(events);
      }

      const schedulePendingStreamFlush = () => {
        if (streamFrame !== null) return;
        streamFrame = window.requestAnimationFrame(() => {
          streamFrame = null;
          if (pendingStreamEvents.length === 0) return;
          const events = pendingStreamEvents.splice(0);
          applyPendingStreamEvents(events);
        });
      };

      const handleEvent = (ev: InboundEvent) => {
        if (ev.event === 'goal_status') {
          chatStore.setAgentStatus(ev.status === 'running' ? 'thinking' : 'idle');
          return;
        }

        if (ev.event === 'delta') {
          if (suppressUntilTurnEnd) return;
          const text = ev.text || '';
          if (!text) return;
          pendingStreamEvents.push({ kind: 'delta', text });
          schedulePendingStreamFlush();
          return;
        }

        if (ev.event === 'reasoning_delta') {
          if (suppressUntilTurnEnd) return;
          const text = ev.text || '';
          if (!text) return;
          pendingStreamEvents.push({ kind: 'reasoning', text });
          schedulePendingStreamFlush();
          return;
        }

        if (ev.event === 'reasoning_end') {
          flushPendingStreamEvents();
          if (assistantMsgId) {
            chatStore.updateMessageThinkingById(conversationId, assistantMsgId, thinking);
          }
          return;
        }

        if (ev.event === 'stream_end') {
          flushPendingStreamEvents();
          if (typeof ev.text === 'string' && assistantMsgId) {
            chatStore.setMessageContent(conversationId, assistantMsgId, ev.text);
          }
          closeAssistantSegment();
          return;
        }

        if (ev.event === 'message') {
          flushPendingStreamEvents();
          if (
            suppressUntilTurnEnd
            && (ev.kind === 'tool_hint' || ev.kind === 'progress' || ev.kind === 'reasoning')
          ) {
            return;
          }

          if (ev.kind === 'reasoning') {
            const text = ev.text || '';
            if (!text) return;
            const targetAssistantMsgId = ensureReasoningSegment();
            thinking += text;
            chatStore.updateMessageThinkingById(conversationId, targetAssistantMsgId, thinking);
            return;
          }

          if (ev.kind === 'tool_hint' || ev.kind === 'progress') {
            closeAssistantSegment();
            chatStore.setAgentStatus('tool-calling');
            addToolTraceMessage(conversationId, loopId, ev.text, ev.tool_events);
            if (assistantMsgId) {
              applyToolEvents(conversationId, assistantMsgId, exec.id, ev.tool_events);
            } else {
              applyToolEvents(null, null, exec.id, ev.tool_events);
            }
            return;
          }

          const text = ev.text || '';
          const targetAssistantMsgId = assistantMsgId ?? ensureAssistantSegment();
          const current = useChatStore.getState().conversations[conversationId]
            ?.messages.find((message) => message.id === targetAssistantMsgId);
          if (text) {
            const currentText = typeof current?.content === 'string' ? current.content : '';
            if (currentText === text || currentText.endsWith(text)) {
              // The gateway can replay the finalized assistant message after stream_end.
              // Keep the existing text instead of appending the same answer twice.
            } else if (currentText && text.startsWith(currentText)) {
              chatStore.setMessageContent(conversationId, targetAssistantMsgId, text);
            } else if (assistantStreamOpen || !current || !currentText.trim()) {
              chatStore.setMessageContent(conversationId, targetAssistantMsgId, text);
            } else {
              const nextAssistantMsgId = ensureAssistantSegment();
              chatStore.setMessageContent(conversationId, nextAssistantMsgId, text);
            }
            chatStore.setAgentStatus('streaming');
          }
          if (ev.media?.length || ev.media_urls?.length) {
            chatStore.appendMessageMedia(conversationId, targetAssistantMsgId, mediaFromEvent(ev));
            suppressUntilTurnEnd = true;
          }
          return;
        }

        if (ev.event === 'file_edit') {
          flushPendingStreamEvents();
          closeAssistantSegment();
          chatStore.setAgentStatus('tool-calling');
          const edits = Array.isArray(ev.edits) ? ev.edits : [];
          addFileEditTraceMessage(conversationId, loopId, edits);
          applyFileEdits(exec.id, edits);
          return;
        }

        if (ev.event === 'turn_end') {
          flushPendingStreamEvents();
          if (typeof ev.latency_ms === 'number' && ev.latency_ms >= 0) {
            chatStore.updateMessageThinkingDuration(conversationId, Math.round(ev.latency_ms / 1000));
          }
          chatStore.setConversationStatus(conversationId, 'completed');
          taskExecutionStore.completeExecution(exec.id);
          settle(resolve);
          return;
        }

        if (ev.event === 'error') {
          flushPendingStreamEvents();
          const reason = ev.reason || ev.detail || 'WebSocket error';
          chatStore.setConversationStatus(conversationId, 'error');
          taskExecutionStore.errorExecution(exec.id, reason);
          settle(() => reject(new Error(reason)));
        }
      };

      const handleAbort = () => {
        flushPendingStreamEvents();
        client.sendMessage(conversationId, '/stop');
        chatStore.setConversationStatus(conversationId, 'idle');
        taskExecutionStore.cancelExecution(exec.id);
        settle(resolve);
      };

      unsubscribe = client.onChat(conversationId, handleEvent);
      signal.addEventListener('abort', handleAbort);

      const outboundMedia: OutboundMedia[] | undefined = userImages?.map((image) => ({
        data_url: `data:${image.mediaType};base64,${image.data}`,
      }));
      client.sendMessage(conversationId, cleanInput, outboundMedia, {
        imageGeneration: options?.imageGeneration,
        cliApps: options?.cliApps,
        mcpPresets: options?.mcpPresets,
        workspaceScope: options?.workspaceScope,
      });
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message === 'canceled')) {
      console.log('[sendNanobotMessage] Execution canceled');
    } else {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[sendNanobotMessage] Error:', err);
      notifyTaskError(errorMessage);
    }
    chatStore.setConversationStatus(conversationId, 'error');
  } finally {
    persistExecutionSnapshot(conversationId, loopId);
    chatStore.setConversationStatus(conversationId, 'idle');
    chatStore.finishAllStreaming(conversationId);
  }
}
