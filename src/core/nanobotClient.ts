/**
 * nanobotClient.ts
 * Renderer-process client for communicating with the embedded nanobot backend.
 */

import { ipc } from '@/lib/ipc-factory';
import { NanobotClient } from './nanobot-client';
import { fetchBootstrap, deriveWsUrl } from './bootstrap';

export interface NanobotStatus {
  ready: boolean;
  port: number;
  tokenSecret: string;
}

export async function getNanobotStatus(): Promise<NanobotStatus> {
  return ipc.invoke('nanobot:status');
}

export interface NanobotSyncResult {
  ok: boolean;
  error?: string;
}

let globalClient: NanobotClient | null = null;
let currentToken = '';

export function getNanobotClient(): NanobotClient {
  if (!globalClient) {
    throw new Error('NanobotClient has not been initialized. Call bootstrapNanobotGateway first.');
  }
  return globalClient;
}

export function getNanobotToken(): string {
  return currentToken;
}

export async function refreshNanobotAuth(): Promise<{ token: string; baseUrl: string; wsUrl: string }> {
  const status = await getNanobotStatus();
  if (!status.ready) {
    throw new Error('Nanobot backend process is not ready yet.');
  }
  const baseUrl = `http://127.0.0.1:${status.port}`;
  const boot = await fetchBootstrap(baseUrl, status.tokenSecret);
  currentToken = boot.token;

  const wsUrl = deriveWsUrl(boot.ws_path, boot.token, boot.ws_url);
  globalClient?.updateUrl(wsUrl);

  return { token: currentToken, baseUrl, wsUrl };
}

/**
 * Initialize and authenticate with the Python nanobot gateway.
 */
export async function bootstrapNanobotGateway(): Promise<NanobotClient> {
  const status = await getNanobotStatus();
  if (!status.ready) {
    throw new Error('Nanobot backend process is not ready yet.');
  }

  const baseUrl = `http://127.0.0.1:${status.port}`;
  console.log('[nanobotClient] Bootstrapping gateway at', baseUrl);
  const { wsUrl } = await refreshNanobotAuth();

  console.log('[nanobotClient] Connecting WebSocket to', wsUrl);
  
  globalClient = new NanobotClient({
    url: wsUrl,
    onReauth: async () => {
      try {
        const refreshed = await fetchBootstrap(baseUrl, status.tokenSecret);
        currentToken = refreshed.token;
        const refreshedUrl = deriveWsUrl(refreshed.ws_path, refreshed.token, refreshed.ws_url);
        globalClient?.updateUrl(refreshedUrl);
        return refreshedUrl;
      } catch (err) {
        console.error('[nanobotClient] Reauth failed:', err);
        return null;
      }
    }
  });

  globalClient.connect();
  return globalClient;
}

/** Placeholder config sync — configuration is now handled directly via gateway API */
export async function syncNanobotSettings(settings: any): Promise<NanobotSyncResult> {
  // Config sync is now a no-op on client side as we configure the gateway dynamically via REST API.
  // We invoke the main config sync to ensure config.json exists on launch.
  try {
    return await ipc.invoke('nanobot:sync-config', settings);
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ─── Stream Turn via WebSocket Multiplex ────────────────────────────────────

/**
 * Stream a chat message through the nanobot API WebSocket channel.
 *
 * @param message   User message text
 * @param sessionId Maps to GUI conversationId
 * @param signal    AbortController signal for cancellation
 */
export async function* nanobotStream(
  message: string,
  sessionId: string,
  signal?: AbortSignal
): AsyncGenerator<{ type: 'text'; text: string } | { type: 'done' }> {
  const client = getNanobotClient();

  const queue: Array<{ type: 'text'; text: string } | { type: 'done' } | { error: any }> = [];
  let resolveNext: (() => void) | null = null;

  // Subscribe to session events on WS channel
  const unsubscribe = client.onChat(sessionId, (ev) => {
    if (ev.event === 'delta') {
      queue.push({ type: 'text', text: ev.text });
      resolveNext?.();
    } else if (ev.event === 'turn_end') {
      queue.push({ type: 'done' });
      resolveNext?.();
    } else if (ev.event === 'error') {
      queue.push({ error: new Error(ev.reason || ev.detail || 'WebSocket Turn Error') });
      resolveNext?.();
    }
  });

  if (signal) {
    signal.addEventListener('abort', () => {
      unsubscribe();
      queue.push({ error: new Error('canceled') });
      resolveNext?.();
    });
  }

  // Submit turn message
  client.sendMessage(sessionId, message);

  try {
    while (true) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
        resolveNext = null;
      }

      const item = queue.shift();
      if (!item) continue;

      if ('error' in item) {
        throw item.error;
      }

      if (item.type === 'done') {
        yield item;
        break;
      }

      yield item;
    }
  } finally {
    unsubscribe();
  }
}

// ─── Non-streaming API Helpers ───────────────────────────────────────────────

/** Read MEMORY.md content from nanobot */
export async function readNanobotMemory(): Promise<string> {
  const status = await getNanobotStatus();
  const token = getNanobotToken();
  const resp = await fetch(`http://127.0.0.1:${status.port}/v1/memory`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) return '';
  const data = await resp.json().catch(() => null);
  return data?.content ?? '';
}

/** Get session info (message count, last summary) from nanobot */
export async function getNanobotSessionInfo(conversationId: string): Promise<{
  messageCount: number;
  lastSummary: string;
}> {
  const status = await getNanobotStatus();
  const token = getNanobotToken();
  const resp = await fetch(`http://127.0.0.1:${status.port}/v1/session/websocket:${conversationId}/info`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) return { messageCount: 0, lastSummary: '' };
  const data = await resp.json().catch(() => null);
  return {
    messageCount: data?.message_count ?? 0,
    lastSummary: data?.last_summary ?? '',
  };
}

// ─── Session Synchronization ────────────────────────────────────────────────

import type { UIMessage, ToolProgressEvent } from './types';
import type { Message, MessageContent, MessageMediaAttachment, ToolCall } from '@/types';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { listSessions, fetchWebuiThread, fetchSettings } from './api';
import { normalizeFileEditToolTraces } from './nanobot/toolTraceMerge';

export function normalizeToolProgressEvents(events: any): ToolProgressEvent[] {
  if (!Array.isArray(events)) return [];
  const out: ToolProgressEvent[] = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const phase = event.phase;
    if (!(phase && typeof phase === 'string' && (phase === 'start' || phase === 'end' || phase === 'error'))) continue;
    const name = typeof event.name === 'string' ? event.name : '';
    const functionName = typeof event.function?.name === 'string' ? String(event.function.name) : '';
    if (!name && !functionName) continue;
    out.push(event);
  }
  return out;
}

function mediaKindFromName(name: string): MessageMediaAttachment['kind'] {
  const ext = name.split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  return 'file';
}

function mediaAttachmentsFromUiMessage(msg: UIMessage): MessageMediaAttachment[] {
  const out: MessageMediaAttachment[] = [];
  for (const item of msg.media ?? []) {
    const name = item.name || item.url?.split(/[/?#]/).filter(Boolean).pop() || item.url || '';
    if (!item.url && !name) continue;
    out.push({
      url: item.url,
      name,
      kind: item.kind || mediaKindFromName(name),
    });
  }
  return out;
}

function toolCallFromEvent(event: ToolProgressEvent): ToolCall | null {
  const callId = event.call_id;
  if (!callId) return null;
  const toolName = event.name || (event as any).function?.name || 'tool';
  const rawArgs = event.arguments || (event as any).function?.arguments;
  let args: Record<string, unknown> = {};
  if (typeof rawArgs === 'string') {
    try { args = JSON.parse(rawArgs) as Record<string, unknown>; } catch {}
  } else if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    args = rawArgs as Record<string, unknown>;
  }
  const result = typeof event.result === 'string'
    ? event.result
    : event.result ? JSON.stringify(event.result) : (event.error ? String(event.error) : '');
  return {
    id: callId,
    name: toolName,
    input: args,
    result,
    isExecuting: event.phase === 'start',
    isError: event.phase === 'error',
  };
}

export function mapWebuiThreadToGuiMessages(webuiMessages: UIMessage[]): Message[] {
  const guiMessages: Message[] = [];
  let lastAssistantMsg: Message | null = null;
  let currentLoopId = '';

  for (const msg of webuiMessages) {
    const timestamp = msg.createdAt || Date.now();

    if (msg.role === 'user') {
      currentLoopId = timestamp.toString(36) + Math.random().toString(36).substring(2, 6);
      
      // Handle content types
      let content: string | MessageContent[] = msg.content;
      if (msg.images && msg.images.length > 0) {
        content = msg.images.map(img => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: 'image/jpeg' as const, // Fallback media type
            data: img.url?.split(',')[1] || '',
          }
        }));
        if (msg.content) {
          (content as any).push({ type: 'text' as const, text: msg.content });
        }
      }

      guiMessages.push({
        id: msg.id,
        role: 'user',
        content,
        timestamp,
        loopId: currentLoopId,
        cliApps: msg.cliApps,
        mcpPresets: msg.mcpPresets,
      });
    } 
    
    else if (msg.role === 'assistant') {
      const guiMsg: Message = {
        id: msg.id,
        role: 'assistant',
        content: msg.content || '',
        timestamp,
        thinking: msg.reasoning,
        reasoningStreaming: msg.reasoningStreaming,
        isStreaming: msg.isStreaming,
        toolCalls: [],
        mediaAttachments: mediaAttachmentsFromUiMessage(msg),
        activitySegmentId: msg.activitySegmentId,
        loopId: currentLoopId,
      };
      guiMessages.push(guiMsg);
      lastAssistantMsg = guiMsg;
    } 
    
    else if (msg.role === 'tool' || msg.kind === 'trace') {
      const events = normalizeToolProgressEvents(msg.toolEvents);
      const traceMsg: Message = {
        id: msg.id,
        role: 'tool',
        kind: 'trace',
        content: msg.content || '',
        traces: msg.traces,
        toolEvents: events,
        fileEdits: msg.fileEdits,
        mediaAttachments: mediaAttachmentsFromUiMessage(msg),
        activitySegmentId: msg.activitySegmentId,
        timestamp,
        loopId: currentLoopId,
      };
      guiMessages.push(traceMsg);

      if (lastAssistantMsg && events.length > 0) {
        if (!lastAssistantMsg.toolCalls) lastAssistantMsg.toolCalls = [];
        for (const ev of events) {
          const call = toolCallFromEvent(ev);
          if (!call) continue;
          const existingIndex = lastAssistantMsg.toolCalls.findIndex(c => c.id === call.id);
          if (existingIndex === -1) {
            lastAssistantMsg.toolCalls.push(call);
          } else {
            lastAssistantMsg.toolCalls[existingIndex] = {
              ...lastAssistantMsg.toolCalls[existingIndex],
              ...call,
            };
          }
        }
      }
    }
  }

  return normalizeFileEditToolTraces(guiMessages);
}

function getMessageText(message: Message): string {
  if (typeof message.content === 'string') return message.content.trim();
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text.trim())
    .join('\n')
    .trim();
}

function isDuplicateMessage(a: Message, b: Message): boolean {
  if (a.role !== b.role) return false;
  if (a.kind !== b.kind) return false;
  const aText = getMessageText(a);
  const bText = getMessageText(b);
  if (!aText || !bText || aText !== bText) return false;
  return Math.abs((a.timestamp ?? 0) - (b.timestamp ?? 0)) < 5 * 60 * 1000;
}

function dedupeAdjacentMessages(messages: Message[]): Message[] {
  const adjacentDedupe: Message[] = [];
  for (const message of messages) {
    const prev = adjacentDedupe[adjacentDedupe.length - 1];
    if (prev && isDuplicateMessage(prev, message)) {
      adjacentDedupe[adjacentDedupe.length - 1] = {
        ...prev,
        ...message,
        id: prev.id,
        loopId: prev.loopId || message.loopId,
        toolCalls: message.toolCalls?.length ? message.toolCalls : prev.toolCalls,
        mediaAttachments: message.mediaAttachments?.length ? message.mediaAttachments : prev.mediaAttachments,
      };
      continue;
    }
    adjacentDedupe.push(message);
  }

  const out: Message[] = [];
  for (let i = 0; i < adjacentDedupe.length; i += 1) {
    const message = adjacentDedupe[i];
    const next = adjacentDedupe[i + 1];
    const prevTurnUser = out[out.length - 2];
    const prevTurnAssistant = out[out.length - 1];
    if (
      message?.role === 'user'
      && next?.role === 'assistant'
      && prevTurnUser?.role === 'user'
      && prevTurnAssistant?.role === 'assistant'
      && isDuplicateMessage(prevTurnUser, message)
      && isDuplicateMessage(prevTurnAssistant, next)
    ) {
      i += 1;
      continue;
    }
    out.push(message);
  }
  return out;
}

function finalizeReplayMessage(message: Message): Message {
  const next: Message = {
    ...message,
  };
  if (message.isStreaming) next.isStreaming = false;
  if (message.reasoningStreaming) next.reasoningStreaming = false;
  if (message.toolCalls) {
    next.toolCalls = message.toolCalls.map((toolCall) => ({ ...toolCall, isExecuting: false }));
  }
  return next;
}

export function projectGatewayMessagesForHistory(gatewayMessages: Message[]): Message[] {
  return dedupeAdjacentMessages(normalizeFileEditToolTraces(gatewayMessages.map(finalizeReplayMessage)));
}

export async function syncSessionsFromGateway(): Promise<void> {
  try {
    const status = await getNanobotStatus();
    if (!status.ready) return;
    
    const token = getNanobotToken();
    const baseUrl = `http://127.0.0.1:${status.port}`;
    const sessions = await listSessions(token, baseUrl);
    const chatStore = useChatStore.getState();

    console.log('[nanobotClient] Found backend sessions:', sessions.length);

    for (const session of sessions) {
      const chatId = session.chatId;
      const thread = await fetchWebuiThread(token, session.key, baseUrl);
      if (thread) {
        const gatewayMessages = mapWebuiThreadToGuiMessages(thread.messages);
        const localStatus = chatStore.conversations[chatId]?.status;
        if (localStatus === 'running') {
          continue;
        }
        const guiMessages = projectGatewayMessagesForHistory(gatewayMessages);
        
        // Save to store using action or setState
        const createdAt = session.createdAt ? new Date(session.createdAt).getTime() : Date.now();
        const updatedAt = session.updatedAt ? new Date(session.updatedAt).getTime() : Date.now();
        
        chatStore.upsertConversation(chatId, {
          id: chatId,
          title: session.title || 'Conversation',
          messages: guiMessages,
          createdAt,
          updatedAt,
          status: 'idle',
          workspacePath: thread.workspace_scope?.project_path ?? null,
        });
      }
    }
  } catch (err) {
    console.error('[nanobotClient] syncSessionsFromGateway error:', err);
  }
}

export async function syncGatewaySettingsToStore(): Promise<void> {
  try {
    const status = await getNanobotStatus();
    if (!status.ready) return;
    
    const token = getNanobotToken();
    const baseUrl = `http://127.0.0.1:${status.port}`;
    const payload = await fetchSettings(token, baseUrl);
    const store = useSettingsStore.getState();

    // Map provider name
    let guiProvider = payload.agent.provider;
    if (guiProvider === 'dashscope') guiProvider = 'bailian';

    store.setProvider(guiProvider as unknown as Parameters<typeof store.setProvider>[0]);
    store.setModel(payload.agent.model);

    // Find provider API key & base url
    const providerObj = payload.providers.find(p => p.name === payload.agent.provider);
    if (providerObj) {
      if (providerObj.configured) {
        store.setApiKey('********');
      } else {
        store.setApiKey('');
      }
      store.setBaseUrl(providerObj.api_base || providerObj.default_api_base || '');
    }

    store.setTemperature(payload.agent.temperature);
    store.setEnableThinking(payload.agent.reasoning_effort === 'medium');

    store.setUseBuiltinWebSearch(payload.web.enable);
    store.setWebSearchProvider(payload.web_search.provider as unknown as Parameters<typeof store.setWebSearchProvider>[0]);
    store.setWebSearchBaseUrl(payload.web_search.base_url || '');

    store.setSandboxEnabled(payload.advanced.restrict_to_workspace);
    store.setAllowPrivateNetworks(payload.advanced.webui_allow_local_service_access);
  } catch (err) {
    console.error('[nanobotClient] syncGatewaySettingsToStore error:', err);
  }
}
