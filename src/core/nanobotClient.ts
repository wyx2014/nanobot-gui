/**
 * nanobotClient.ts
 * Renderer-process client for communicating with the embedded nanobot backend.
 */

import { ipc } from '@/lib/ipc-factory';
import { NanobotClient } from './nanobot-client';
import { fetchBootstrap, deriveWsUrl } from './bootstrap';
import type { BootstrapResponse, ConnectionStatus } from './types';

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
let currentBaseUrl = '';
let globalConnectionStatus: ConnectionStatus = 'idle';
let globalStatusUnsubscribe: (() => void) | null = null;
let globalRuntimeStatusUnsubscribe: (() => void) | null = null;
let globalRuntimeSnapshotUnsubscribe: (() => void) | null = null;
let globalRuntimeSnapshotGapUnsubscribe: (() => void) | null = null;
let globalMcpStatus: NonNullable<BootstrapResponse['mcp_status']> = 'unknown';
const globalConnectionListeners = new Set<() => void>();

function setGlobalConnectionStatus(status: ConnectionStatus): void {
  if (globalConnectionStatus === status) return;
  globalConnectionStatus = status;
  for (const listener of globalConnectionListeners) listener();
}

export function getNanobotConnectionStatus(): ConnectionStatus {
  return globalConnectionStatus;
}

export function getNanobotMcpStatus(): NonNullable<BootstrapResponse['mcp_status']> {
  return globalMcpStatus;
}

export function subscribeNanobotConnectionStatus(listener: () => void): () => void {
  globalConnectionListeners.add(listener);
  return () => globalConnectionListeners.delete(listener);
}

export function getNanobotClient(): NanobotClient {
  if (!globalClient) {
    throw new Error('NanobotClient has not been initialized. Call bootstrapNanobotGateway first.');
  }
  return globalClient;
}

export function getNanobotToken(): string {
  return currentToken;
}

export function getGatewayBaseUrl(): string {
  return currentBaseUrl;
}

export async function refreshNanobotAuth(): Promise<{ token: string; baseUrl: string; wsUrl: string }> {
  const status = await getNanobotStatus();
  if (!status.ready) {
    throw new Error('Nanobot backend process is not ready yet.');
  }
  const baseUrl = `http://127.0.0.1:${status.port}`;
  const boot = await fetchBootstrap(baseUrl, status.tokenSecret);
  if (boot.agent_ready === false) {
    throw new Error('Nanobot agent loop is not ready yet.');
  }
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
  currentBaseUrl = baseUrl;
  console.log('[nanobotClient] Bootstrapping gateway at', baseUrl);
  const { wsUrl } = await refreshNanobotAuth();

  console.log('[nanobotClient] Connecting WebSocket to', wsUrl);

  globalStatusUnsubscribe?.();
  globalStatusUnsubscribe = null;
  globalRuntimeStatusUnsubscribe?.();
  globalRuntimeStatusUnsubscribe = null;
  globalRuntimeSnapshotUnsubscribe?.();
  globalRuntimeSnapshotUnsubscribe = null;
  globalRuntimeSnapshotGapUnsubscribe?.();
  globalRuntimeSnapshotGapUnsubscribe = null;
  globalClient?.close();
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

  let hasOpened = false;
  globalStatusUnsubscribe = globalClient.onStatus((connectionStatus) => {
    setGlobalConnectionStatus(connectionStatus);
    if (connectionStatus !== 'open') return;
    if (hasOpened) {
      void syncSessionsFromGateway();
    }
    hasOpened = true;
  });
  globalRuntimeStatusUnsubscribe = globalClient.onRuntimeStatus((_agentReady, mcpStatus) => {
    if (globalMcpStatus === mcpStatus) return;
    globalMcpStatus = mcpStatus;
    for (const listener of globalConnectionListeners) listener();
  });
  globalRuntimeSnapshotUnsubscribe = globalClient.onRuntimeSnapshot((chatId, snapshot) => {
    useChatStore.getState().setConversationRuntimeSnapshot(chatId, snapshot);
  });
  globalRuntimeSnapshotGapUnsubscribe = globalClient.onRuntimeSnapshotGap((chatId) => {
    void fetchSessionRuntimeSnapshot(
      currentToken,
      `websocket:${chatId}`,
      currentBaseUrl,
    ).then((snapshot) => {
      if (snapshot) globalClient?.applyRuntimeSnapshot(chatId, snapshot);
    }).catch((error) => {
      console.warn('[nanobotClient] Runtime snapshot gap refresh failed:', error);
    });
  });
  globalClient.connect();
  try {
    await globalClient.waitUntilReady();
  } catch (error) {
    setGlobalConnectionStatus('error');
    throw error;
  }
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
  let token = getNanobotToken();
  let resp = await fetch(`http://127.0.0.1:${status.port}/v1/memory`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (resp.status === 401) {
    try {
      const refreshed = await refreshNanobotAuth();
      token = refreshed.token;
      resp = await fetch(`http://127.0.0.1:${status.port}/v1/memory`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch {}
  }
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
  let token = getNanobotToken();
  let resp = await fetch(`http://127.0.0.1:${status.port}/v1/session/websocket:${conversationId}/info`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (resp.status === 401) {
    try {
      const refreshed = await refreshNanobotAuth();
      token = refreshed.token;
      resp = await fetch(`http://127.0.0.1:${status.port}/v1/session/websocket:${conversationId}/info`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch {}
  }
  if (!resp.ok) return { messageCount: 0, lastSummary: '' };
  const data = await resp.json().catch(() => null);
  return {
    messageCount: data?.message_count ?? 0,
    lastSummary: data?.last_summary ?? '',
  };
}

// ─── Session Synchronization ────────────────────────────────────────────────

import type { ChatSummary, UIMessage, ToolProgressEvent } from './types';
import type { Conversation, Message, MessageContent, MessageMediaAttachment, ToolCall } from '@/types';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  listProjects,
  listSessions,
  fetchWebuiThread,
  fetchSessionRuntimeSnapshot,
  fetchSettings,
  registerTokenProvider,
} from './api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { normalizeFileEditToolTraces } from './nanobot/toolTraceMerge';
import { scrubSubagentUiMessages } from './nanobot/subagent-channel-display';
import { normalizeLegacyLongTaskMessages } from './nanobot/thread-display-compat';

// Register token provider to automatically refresh and retry REST API calls on 401 Unauthorized
registerTokenProvider(async () => {
  const refreshed = await refreshNanobotAuth();
  return refreshed.token;
});

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

function resolveMediaUrl(url: string | undefined): string | undefined {
  if (!url || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }
  const base = getGatewayBaseUrl();
  if (!base) return url;
  return `${base}${url.startsWith('/') ? url : `/${url}`}`;
}

function mediaAttachmentsFromUiMessage(msg: UIMessage): MessageMediaAttachment[] {
  const out: MessageMediaAttachment[] = [];
  const artifactIndexes = new Map<string, number>();
  for (const item of msg.media ?? []) {
    const resolvedUrl = resolveMediaUrl(item.url);
    const name = item.name || resolvedUrl?.split(/[/?#]/).filter(Boolean).pop() || resolvedUrl || '';
    if (!resolvedUrl && !name) continue;
    const kind = item.kind || mediaKindFromName(name);
    // Generated files may be attached once during streaming and once while
    // restoring artifacts from the persisted tool result. Those deliveries use
    // distinct signed URLs for the same file, so URL-based de-duplication is
    // ineffective. A local path is authoritative; staged artifacts fall back
    // to their stable display metadata.
    const artifactKeys = [
      ...(item.local_path ? [`path:${item.local_path}`] : []),
      ...(name && item.size !== undefined ? [`meta:${name}:${item.mime_type ?? ''}:${kind}:${item.size}`] : []),
    ];
    const attachment: MessageMediaAttachment = {
      id: item.id,
      url: resolvedUrl,
      downloadUrl: item.download_url ? resolveMediaUrl(item.download_url) : undefined,
      localPath: item.local_path,
      name,
      kind,
      mimeType: item.mime_type,
      size: item.size,
    };
    const duplicateIndex = artifactKeys
      .map((key) => artifactIndexes.get(key))
      .find((index): index is number => index !== undefined);
    if (duplicateIndex !== undefined) {
      // Prefer replayed metadata when it supplies the original local path.
      // This lets old streamed artifacts gain Finder support after history sync.
      const existing = out[duplicateIndex];
      out[duplicateIndex] = {
        ...existing,
        ...attachment,
        url: attachment.url ?? existing.url,
        downloadUrl: attachment.downloadUrl ?? existing.downloadUrl,
        localPath: attachment.localPath ?? existing.localPath,
      };
      artifactKeys.forEach((key) => artifactIndexes.set(key, duplicateIndex));
      continue;
    }
    const index = out.length;
    out.push(attachment);
    artifactKeys.forEach((key) => artifactIndexes.set(key, index));
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

export function stripRedundantMcpMentionPrefix(
  content: string,
  mcpPresets: ReadonlyArray<{ name: string }> | undefined,
): string {
  if (!content || !mcpPresets?.length) return content;

  const connectorNames = new Set(
    mcpPresets
      .map((preset) => preset.name.trim().toLocaleLowerCase())
      .filter(Boolean),
  );
  if (connectorNames.size === 0) return content;

  const lineBreak = content.match(/\r?\n/);
  const firstLineEnd = lineBreak?.index ?? content.length;
  const firstLine = content.slice(0, firstLineEnd).trim();
  const tokens = firstLine ? firstLine.split(/\s+/) : [];

  // Composer-generated capability prefixes consist only of @mentions. Never
  // rewrite natural-language text merely because it happens to contain @name.
  if (tokens.length === 0 || tokens.some((token) => !/^@\S+$/.test(token))) {
    return content;
  }

  const remainingTokens = tokens.filter(
    (token) => !connectorNames.has(token.slice(1).toLocaleLowerCase()),
  );
  if (remainingTokens.length === tokens.length) return content;

  const suffix = lineBreak
    ? content.slice(firstLineEnd + lineBreak[0].length)
    : '';
  if (remainingTokens.length > 0) {
    return `${remainingTokens.join(' ')}${lineBreak?.[0] ?? ''}${suffix}`;
  }

  return suffix.replace(/^(?:[ \t]*\r?\n)+/, '');
}

export function mapWebuiThreadToGuiMessages(webuiMessages: UIMessage[]): Message[] {
  const guiMessages: Message[] = [];
  let lastAssistantMsg: Message | null = null;
  let currentLoopId = '';

  for (const msg of webuiMessages) {
    const timestamp = msg.createdAt || Date.now();

    if (msg.role === 'user') {
      currentLoopId = timestamp.toString(36) + Math.random().toString(36).substring(2, 6);
      
      // MCP attachments already render as chips. Older transcripts may also
      // contain the composer-generated @preset prefix; hide that duplicate.
      const visibleContent = stripRedundantMcpMentionPrefix(msg.content, msg.mcpPresets);
      let content: string | MessageContent[] = visibleContent;
      if (msg.images && msg.images.length > 0) {
        content = msg.images.map(img => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: 'image/jpeg' as const, // Fallback media type
            data: img.url?.split(',')[1] || '',
          }
        }));
        if (visibleContent) {
          (content as any).push({ type: 'text' as const, text: visibleContent });
        }
      }

      guiMessages.push({
        id: msg.id,
        role: 'user',
        content,
        timestamp,
        loopId: currentLoopId,
        interactivePromptAnswer: msg.interactivePromptAnswer,
        cliApps: msg.cliApps,
        mcpPresets: msg.mcpPresets,
      });
    } 
    
    else if (msg.role === 'assistant' && msg.kind !== 'trace') {
      const guiMsg: Message = {
        id: msg.id,
        role: 'assistant',
        content: msg.content || '',
        timestamp,
        interactivePrompt: msg.interactivePrompt,
        thinking: msg.reasoning,
        thinkingDuration: typeof msg.latencyMs === 'number' && Number.isFinite(msg.latencyMs)
          ? Math.max(0, msg.latencyMs / 1000)
          : undefined,
        completedAt: typeof msg.completedAt === 'number' && Number.isFinite(msg.completedAt)
          ? msg.completedAt
          : undefined,
        usage: msg.usage,
        reasoningStreaming: msg.reasoningStreaming,
        isStreaming: msg.isStreaming,
        toolCalls: [],
        mediaAttachments: mediaAttachmentsFromUiMessage(msg),
        activitySegmentId: msg.activitySegmentId,
        narration: msg.narration,
        narrationStreaming: msg.narrationStreaming,
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
        agentUI: msg.agentUI,
        fileEdits: msg.fileEdits,
        mediaAttachments: mediaAttachmentsFromUiMessage(msg),
        activitySegmentId: msg.activitySegmentId,
        narration: msg.narration,
        narrationStreaming: msg.narrationStreaming,
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
  if (message.narrationStreaming) next.narrationStreaming = false;
  if (message.toolCalls) {
    next.toolCalls = message.toolCalls.map((toolCall) => ({ ...toolCall, isExecuting: false }));
  }
  return next;
}

export function projectGatewayMessagesForHistory(gatewayMessages: Message[]): Message[] {
  return dedupeAdjacentMessages(normalizeFileEditToolTraces(gatewayMessages.map(finalizeReplayMessage)));
}

function titleFromSession(sessionTitle: string | undefined, messages: Message[]): string {
  const title = sessionTitle?.trim();
  if (title) return title;
  const firstUser = messages.find((message) => message.role === 'user');
  const content = typeof firstUser?.content === 'string'
    ? firstUser.content
    : firstUser?.content.find((item) => item.type === 'text')?.text;
  const trimmed = content?.trim();
  if (trimmed) return trimmed.slice(0, 30) + (trimmed.length > 30 ? '...' : '');
  return '新对话';
}

export async function syncSessionFromGateway(
  sessionKey: string,
  options: { scheduledTaskId?: string; title?: string } = {},
): Promise<boolean> {
  try {
    const status = await getNanobotStatus();
    if (!status.ready) return false;

    const token = getNanobotToken();
    const baseUrl = `http://127.0.0.1:${status.port}`;
    const [thread, runtimeSnapshot] = await Promise.all([
      fetchWebuiThread(token, sessionKey, baseUrl),
      fetchSessionRuntimeSnapshot(token, sessionKey, baseUrl),
    ]);
    if (!thread) return false;
    const chatId = sessionKey.startsWith('websocket:')
      ? sessionKey.slice('websocket:'.length)
      : sessionKey;
    if (runtimeSnapshot) {
      globalClient?.applyRuntimeSnapshot(chatId, runtimeSnapshot);
    }

    const gatewayMessages = mapWebuiThreadToGuiMessages(scrubSubagentUiMessages(normalizeLegacyLongTaskMessages(thread.messages)));
    const guiMessages = projectGatewayMessagesForHistory(gatewayMessages);
    if (guiMessages.length === 0) return false;

    const firstTimestamp = guiMessages[0]?.timestamp ?? Date.now();
    const lastTimestamp = guiMessages[guiMessages.length - 1]?.timestamp ?? firstTimestamp;
    const savedAt = thread.savedAt ? new Date(thread.savedAt).getTime() : NaN;

    useChatStore.getState().upsertConversation(sessionKey, {
      id: sessionKey,
      sessionId: thread.session_id,
      projectId: thread.project_id,
      title: options.title ?? titleFromSession(undefined, guiMessages),
      messages: guiMessages,
      createdAt: firstTimestamp,
      updatedAt: Number.isFinite(savedAt) ? savedAt : lastTimestamp,
      status: runtimeSnapshot?.thread_status.type === 'active'
        ? 'running'
        : runtimeSnapshot?.thread_status.type === 'systemError'
          ? 'error'
          : 'idle',
      ...(runtimeSnapshot ? { runtimeSnapshot } : {}),
      workspacePath: thread.workspace_scope?.project_path ?? null,
      workspaceScope: thread.workspace_scope ?? null,
      expertTeam: thread.expert_team ?? null,
      ...(options.scheduledTaskId ? { scheduledTaskId: options.scheduledTaskId } : {}),
    });
    return true;
  } catch (err) {
    console.error('[nanobotClient] syncSessionFromGateway error:', err);
    return false;
  }
}

export function shouldPreserveRunningConversation(
  localStatus: string | undefined,
  runtimeStartedAt: number | null | undefined,
  listedRunStartedAt: number | null | undefined,
): boolean {
  return (
    localStatus === 'running'
    && (runtimeStartedAt != null || listedRunStartedAt != null)
  );
}

export function conversationFromSessionSummary(
  session: ChatSummary,
  existing?: Conversation,
): Conversation {
  const preview = session.preview?.trim();
  const listedTitle = session.title?.trim();
  const existingTitle = existing?.title?.trim();
  const createdAt = session.createdAt
    ? new Date(session.createdAt).getTime()
    : existing?.createdAt ?? Date.now();
  const updatedAt = session.updatedAt
    ? new Date(session.updatedAt).getTime()
    : existing?.updatedAt ?? createdAt;
  const safeCreatedAt = Number.isFinite(createdAt) ? createdAt : Date.now();

  return {
    id: session.chatId,
    sessionId: session.sessionId ?? existing?.sessionId,
    projectId: session.projectId ?? existing?.projectId,
    hasHistory: true,
    title: (
      listedTitle
      || (existingTitle && existingTitle !== '新对话' ? existingTitle : '')
      || preview
      || '新对话'
    ).slice(0, 30),
    messages: existing?.messages ?? [],
    createdAt: safeCreatedAt,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : safeCreatedAt,
    status: session.runStartedAt != null ? 'running' : 'idle',
    workspacePath: session.workspaceScope?.project_path ?? existing?.workspacePath ?? null,
    workspaceScope: session.workspaceScope ?? existing?.workspaceScope ?? null,
    expertTeam: session.expertTeam ?? existing?.expertTeam ?? null,
    ...(existing?.scheduledTaskId ? { scheduledTaskId: existing.scheduledTaskId } : {}),
  };
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

    const runningSessions: Array<{ chatId: string; key: string }> = [];
    const conversations: Record<string, Conversation> = {};
    for (const session of sessions) {
      const chatId = session.chatId;
      const existing = useChatStore.getState().conversations[chatId];
      const isRunning = session.runStartedAt != null;

      // Startup synchronization is metadata-only. ChatView already loads the
      // canonical thread on demand when the user opens a conversation.
      conversations[chatId] = conversationFromSessionSummary(session, existing);
      if (isRunning) {
        runningSessions.push({ chatId, key: session.key });
      }
    }
    chatStore.upsertConversations(conversations);

    // Only active turns need a process-local runtime snapshot at startup.
    // Completed conversations are hydrated lazily by ChatView.
    await Promise.allSettled(runningSessions.map(async ({ chatId, key }) => {
      const runtimeSnapshot = await fetchSessionRuntimeSnapshot(token, key, baseUrl);
      if (!runtimeSnapshot) return;
      globalClient?.applyRuntimeSnapshot(chatId, runtimeSnapshot);
      useChatStore.getState().setConversationRuntimeSnapshot(chatId, runtimeSnapshot);
    }));
  } catch (err) {
    console.error('[nanobotClient] syncSessionsFromGateway error:', err);
  }
}

export async function syncProjectsFromGateway(): Promise<void> {
  try {
    const status = await getNanobotStatus();
    if (!status.ready) return;
    const token = getNanobotToken();
    const baseUrl = `http://127.0.0.1:${status.port}`;
    const projects = await listProjects(token, baseUrl);
    useWorkspaceStore.getState().setProjects(projects);
  } catch (err) {
    console.error('[nanobotClient] syncProjectsFromGateway error:', err);
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
    store.setVoiceMaxDurationSec(payload.transcription.max_duration_sec);

    store.setSandboxEnabled(payload.advanced.restrict_to_workspace);
    store.setAllowPrivateNetworks(payload.advanced.webui_allow_local_service_access);
  } catch (err) {
    console.error('[nanobotClient] syncGatewaySettingsToStore error:', err);
  }
}
