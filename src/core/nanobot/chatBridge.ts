import type { ImageAttachment, MessageContent, ToolCall } from '@/types';
import type { OutboundMedia } from '@/core/types';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTaskExecutionStore } from '@/stores/taskExecutionStore';
import { notifyTaskError } from '@/utils/notifications';
import { getNanobotClient, normalizeToolProgressEvents } from '@/core/nanobotClient';
import { snapshotExecutionSteps } from './executionSnapshot';

export interface NanobotSendOptions {
  images?: ImageAttachment[];
  loopId?: string;
}

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
    chatStore.clearAbortController(conversationId);
    chatStore.setConversationStatus(conversationId, 'running');

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
    });

    const assistantMsgId = generateId();
    chatStore.addMessage(conversationId, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      loopId,
      isStreaming: true,
    });

    const abortController = chatStore.getAbortController(conversationId);
    const signal = abortController.signal;

    try {
      await new Promise<void>((resolve, reject) => {
        const client = getNanobotClient();
        const exec = taskExecutionStore.getExecutionByLoopId(loopId);
        if (!exec) {
          reject(new Error('Failed to create execution context'));
          return;
        }

        chatStore.setAgentStatus('thinking');

        const unsubscribe = client.onChat(conversationId, (ev) => {
          if (ev.event === 'delta') {
            const text = ev.text || '';
            if (text) {
              chatStore.setAgentStatus('streaming');
              chatStore.appendToLastMessage(conversationId, text);
            }
          } else if (ev.event === 'reasoning_delta') {
            const text = ev.text || '';
            if (text) {
              chatStore.setAgentStatus('thinking');
              const activeConv = chatStore.conversations[conversationId];
              const lastMsg = activeConv?.messages[activeConv.messages.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                chatStore.updateMessageThinking(conversationId, (lastMsg.thinking || '') + text);
              }
            }
          } else if (ev.event === 'message' && (ev.kind === 'tool_hint' || ev.kind === 'progress')) {
            chatStore.setAgentStatus('tool-calling');
            const events = normalizeToolProgressEvents(ev.tool_events);
            for (const event of events) {
              const callId = event.call_id;
              if (!callId) continue;

              const toolName = event.name || (event as any).function?.name || 'tool';
              const rawArgs = event.arguments || (event as any).function?.arguments;
              let args: Record<string, unknown> = {};
              if (typeof rawArgs === 'string') {
                try { args = JSON.parse(rawArgs) as Record<string, unknown>; } catch {}
              } else if (rawArgs && typeof rawArgs === 'object') {
                args = rawArgs as Record<string, unknown>;
              }

              if (event.phase === 'start') {
                const toolCall: ToolCall = {
                  id: callId,
                  name: toolName,
                  input: args,
                  isExecuting: true,
                  startTime: Date.now(),
                };
                chatStore.addToolCall(conversationId, assistantMsgId, toolCall);
                taskExecutionStore.addStep(exec.id, {
                  id: callId,
                  executionId: exec.id,
                  type: 'tool',
                  label: toolName,
                  status: 'running',
                  toolName,
                  startTime: Date.now(),
                  toolInput: args,
                  source: 'agent',
                  detailBlocks: [],
                });
              } else if (event.phase === 'end' || event.phase === 'error') {
                const isError = event.phase === 'error';
                const resultStr = typeof event.result === 'string'
                  ? event.result
                  : event.result ? JSON.stringify(event.result) : (event.error ? String(event.error) : '');

                chatStore.updateToolCall(conversationId, assistantMsgId, callId, resultStr, undefined, isError);
                taskExecutionStore.setStepResult(exec.id, callId, resultStr);
                if (isError) {
                  taskExecutionStore.setStepError(exec.id, callId, resultStr);
                }
              }
            }
          } else if (ev.event === 'file_edit') {
            const edits = Array.isArray(ev.edits) ? ev.edits : [];
            for (const edit of edits) {
              if (!edit.path) continue;
              const stepId = edit.call_id || `file_edit:${edit.path}`;
              const step = taskExecutionStore.findStep(exec.id, stepId);
              if (!step) continue;
              taskExecutionStore.addDetailBlock(exec.id, stepId, {
                id: `edit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                stepId,
                type: 'diff',
                label: `${edit.operation === 'delete' ? 'Deleted' : 'Edited'} ${edit.path}`,
                content: `+${edit.added} -${edit.deleted} lines`,
                isTruncated: false,
                isExpanded: false,
              });
            }
          } else if (ev.event === 'turn_end') {
            chatStore.setConversationStatus(conversationId, 'completed');
            taskExecutionStore.completeExecution(exec.id);
            unsubscribe();
            resolve();
          } else if (ev.event === 'error') {
            const reason = ev.reason || ev.detail || 'WebSocket error';
            chatStore.setConversationStatus(conversationId, 'error');
            taskExecutionStore.errorExecution(exec.id, reason);
            unsubscribe();
            reject(new Error(reason));
          }
        });

        signal.addEventListener('abort', () => {
          unsubscribe();
          client.sendMessage(conversationId, '/stop');
          chatStore.setConversationStatus(conversationId, 'idle');
          taskExecutionStore.cancelExecution(exec.id);
          resolve();
        });

        const outboundMedia: OutboundMedia[] | undefined = userImages?.map((image) => ({
          data_url: `data:${image.mediaType};base64,${image.data}`,
        }));
        client.sendMessage(conversationId, cleanInput, outboundMedia);
      });
    } finally {
      persistExecutionSnapshot(conversationId, loopId);
      chatStore.setConversationStatus(conversationId, 'idle');
      chatStore.finishStreaming(conversationId);
    }
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message === 'canceled')) {
      console.log('[sendNanobotMessage] Execution canceled');
    } else {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[sendNanobotMessage] Error:', err);
      notifyTaskError(errorMessage);
    }
    chatStore.setConversationStatus(conversationId, 'error');
    chatStore.finishStreaming(conversationId);
  }
}
