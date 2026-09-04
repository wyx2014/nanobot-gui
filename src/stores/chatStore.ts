import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Message, Conversation, AgentStatus, TokenUsage, ConversationStatus, ToolCall, ToolCallContext, ToolResultContent, MessageMediaAttachment } from '../types';
import type { ExecutionStepSnapshot } from '../types/execution';
import type { ExpertTeamBinding, ThreadRuntimeSnapshot, UIMcpPresetAttachment, WorkspaceScopePayload } from '@/core/types';
import { useWorkspaceStore } from './workspaceStore';
import { useTaskExecutionStore } from './taskExecutionStore';
import { useConversationWorkbenchStore } from './conversationWorkbenchStore';
import { useTurnPlanStore } from './turnPlanStore';
import { clearTodos } from '../core/nanobot/todoManager';
import { clearInputQueue } from '../core/nanobot/userInputQueue';
import { getNanobotToken, getNanobotStatus } from '@/core/nanobotClient';
import { archiveSession } from '@/core/api';
import { conversationIdToSessionKey } from '@/core/sessionKey';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// Store abort controllers for each conversation
const abortControllers: Map<string, AbortController> = new Map();

// Persistence limits
const MAX_CONVERSATIONS = 50;
const MAX_CONVERSATION_NAVIGATION_HISTORY = 100;

interface ConversationNavigationState {
  conversations: Record<string, Conversation>;
  activeConversationId: string | null;
  conversationNavigationHistory: string[];
}

function activateConversation(
  state: ConversationNavigationState,
  targetId: string | null,
): void {
  const currentId = state.activeConversationId;
  if (currentId === targetId) return;

  let history = state.conversationNavigationHistory.filter(
    (id) => id !== targetId && id !== currentId && state.conversations[id] !== undefined,
  );
  if (currentId && state.conversations[currentId]) {
    history.push(currentId);
  }
  if (history.length > MAX_CONVERSATION_NAVIGATION_HISTORY) {
    history = history.slice(-MAX_CONVERSATION_NAVIGATION_HISTORY);
  }
  state.conversationNavigationHistory = history;
  state.activeConversationId = targetId;
}

function removeConversationFromNavigation(
  state: ConversationNavigationState,
  deletedId: string,
): void {
  state.conversationNavigationHistory = state.conversationNavigationHistory.filter(
    (id) => id !== deletedId,
  );
  if (state.activeConversationId !== deletedId) return;

  let previousId: string | null = null;
  while (state.conversationNavigationHistory.length > 0) {
    const candidate = state.conversationNavigationHistory.pop();
    if (candidate && state.conversations[candidate]) {
      previousId = candidate;
      break;
    }
  }
  state.activeConversationId = previousId;
}

/**
 * Persist only conversation metadata. Nanobot's `/webui-thread` snapshot is the
 * canonical chat transcript; keeping a second local message history causes
 * post-restart pairing drift between user turns, assistant slices, tools, and media.
 */
function stripMessagesForPersist(conversations: Record<string, Conversation>): Record<string, Conversation> {
  const result: Record<string, Conversation> = {};
  for (const [id, conv] of Object.entries(conversations)) {
    result[id] = {
      ...conv,
      messages: [],
      status: conv.status === 'running' ? 'idle' : conv.status,
      runtimeSnapshot: undefined,
      completedAt: undefined,
      contextCache: undefined,
    };
  }
  return result;
}

interface ChatState {
  conversations: Record<string, Conversation>;
  activeConversationId: string | null;
  /** Ephemeral back stack of conversations loaded during this app run. */
  conversationNavigationHistory: string[];
  agentStatus: AgentStatus;
  currentTool: string | null;
  // Token usage tracking
  currentUsage: TokenUsage | null;
  // Pending input for prefilling the chat input
  pendingInput: string | null;
  // Expert team preselected for the welcome composer. No gateway session is
  // created until the user sends the first message.
  pendingExpertTeam: ExpertTeamBinding | null;
  // Thinking timer
  thinkingStartTime: number | null;
  // Track multiple concurrent active agents
  activeAgentNames: string[];
}

interface ChatActions {
  createConversation: (workspacePath?: string | null, options?: { id?: string; scheduledTaskId?: string; skipActivate?: boolean; workspaceScope?: WorkspaceScopePayload | null; title?: string; expertTeam?: ExpertTeamBinding | null }) => string;
  startNewConversation: (options?: { expertTeam?: ExpertTeamBinding | null }) => void;
  switchConversation: (id: string) => void;
  setConversationWorkspace: (convId: string, path: string | null) => void;
  setConversationWorkspaceScope: (convId: string, scope: WorkspaceScopePayload | null) => void;
  setConversationIdentity: (convId: string, sessionId?: string, projectId?: string) => void;
  setConversationExpertTeam: (convId: string, team: ExpertTeamBinding | null) => void;
  setConversationMcpPresets: (convId: string, presets: UIMcpPresetAttachment[]) => void;
  archiveConversation: (id: string) => Promise<void>;
  removeConversationLocally: (id: string) => void;
  renameConversation: (id: string, title: string) => void;

  addMessage: (convId: string, message: Message) => void;
  updateConversationMessages: (convId: string, updater: (messages: Message[]) => Message[]) => void;
  appendToLastMessage: (convId: string, token: string) => void;
  appendToMessage: (convId: string, messageId: string, token: string) => void;
  setLastMessageContent: (convId: string, content: string) => void;
  setMessageContent: (convId: string, messageId: string, content: string) => void;
  appendMessageMedia: (convId: string, messageId: string, media: MessageMediaAttachment[]) => void;
  finishStreaming: (convId: string) => void;
  finishAllStreaming: (convId: string) => void;
  updateToolCall: (convId: string, messageId: string, toolCallId: string, result: string, resultContent?: ToolResultContent[], isError?: boolean, hideScreenshot?: boolean) => void;

  // New message operations
  deleteMessage: (convId: string, messageId: string) => void;
  deleteMessagesFrom: (convId: string, messageId: string) => void;
  deleteLoopMessages: (convId: string, loopId: string) => void;
  updateMessageThinking: (convId: string, thinking: string) => void;
  updateMessageThinkingById: (convId: string, messageId: string, thinking: string) => void;
  updateMessageThinkingDuration: (convId: string, duration: number) => void;
  updateMessageUsage: (convId: string, usage: TokenUsage) => void;
  appendToolCallContext: (convId: string, loopId: string, context: ToolCallContext) => void;
  setExecutionStepsSnapshot: (convId: string, loopId: string, steps: ExecutionStepSnapshot[]) => void;

  // Streaming control
  getAbortController: (convId: string) => AbortController;
  cancelStreaming: (convId: string) => void;
  clearAbortController: (convId: string) => void;

  setAgentStatus: (status: AgentStatus, tool?: string, agentName?: string) => void;
  removeActiveAgent: (agentName: string) => void;
  setCurrentUsage: (usage: TokenUsage | null) => void;
  setPendingInput: (text: string | null) => void;
  setPendingExpertTeam: (team: ExpertTeamBinding | null) => void;
  setConversationStatus: (convId: string, status: ConversationStatus) => void;
  setConversationRuntimeSnapshot: (convId: string, snapshot: ThreadRuntimeSnapshot) => void;
  clearCompletedStatus: (convId: string) => void;

  // MCP per-session toggle
  toggleMCPServer: (convId: string, serverName: string) => void;

  // Context compression cache
  setContextCache: (convId: string, cache: import('../types').ContextCache) => void;
  clearContextCache: (convId: string) => void;

  addToolCall: (convId: string, messageId: string, toolCall: ToolCall) => void;
  upsertConversation: (id: string, conversation: Conversation) => void;
  upsertConversations: (conversations: Record<string, Conversation>) => void;
  reconcileGatewayConversations: (conversations: Record<string, Conversation>) => void;

  // Export/Import
  exportConversation: (convId: string) => string | null;
  importConversation: (json: string) => string | null;
}

export type ChatStore = ChatState & ChatActions;

export const useChatStore = create<ChatStore>()(
  persist(
    immer((set, get) => ({
      conversations: {},
      activeConversationId: null,
      conversationNavigationHistory: [],
      agentStatus: 'idle' as AgentStatus,
      currentTool: null,
      currentUsage: null,
      pendingInput: null,
      pendingExpertTeam: null,
      thinkingStartTime: null,
      activeAgentNames: [],

      createConversation: (workspacePath, options) => {
        const id = options?.id?.trim() || generateId();
        const now = Date.now();
        const scope = options?.workspaceScope ?? null;
        const path = workspacePath ?? scope?.project_path ?? null;
        const title = options?.title?.trim() || '新对话';
        set((state) => {
          state.conversations[id] = {
            id,
            title,
            messages: [],
            createdAt: now,
            updatedAt: now,
            status: 'idle',
            workspacePath: path,
            workspaceScope: scope,
            expertTeam: options?.expertTeam ?? null,
            mcpPresets: [],
            ...(options?.scheduledTaskId ? { scheduledTaskId: options.scheduledTaskId } : {}),
          };
          if (!options?.skipActivate) {
            activateConversation(state, id);
            // The gateway-backed conversation now owns this binding. Clear the
            // welcome draft so it cannot leak into a later new conversation.
            state.pendingExpertTeam = null;
          }
        });
        // Sync global workspace to match the new conversation
        if (path && !options?.skipActivate) {
          useWorkspaceStore.getState().setWorkspace(path);
        }
        return id;
      },

      startNewConversation: (options) => {
        set((state) => {
          activateConversation(state, null);
          state.pendingExpertTeam = options?.expertTeam ?? null;
        });
        // Clear global workspace so welcome page starts clean
        useWorkspaceStore.getState().clearWorkspace();
      },

      switchConversation: (id) => {
        const conv = get().conversations[id];
        if (!conv) return;
        set((state) => {
          activateConversation(state, id);
        });
        // Sync global workspace to match the target conversation
        const ws = useWorkspaceStore.getState();
        if (conv?.workspacePath) {
          ws.setWorkspace(conv.workspacePath);
        } else {
          ws.clearWorkspace();
        }
      },

      setConversationWorkspace: (convId, path) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (conv) {
            conv.workspacePath = path;
            conv.workspaceScope = null;
          }
        });
      },

      setConversationWorkspaceScope: (convId, scope) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (conv) {
            conv.workspaceScope = scope;
            conv.workspacePath = scope?.project_path ?? null;
          }
        });
      },

      setConversationIdentity: (convId, sessionId, projectId) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (!conv) return;
          if (sessionId) conv.sessionId = sessionId;
          if (projectId) conv.projectId = projectId;
        });
      },

      setConversationExpertTeam: (convId, team) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (conv) conv.expertTeam = team;
        });
      },

      setConversationMcpPresets: (convId, presets) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (conv) conv.mcpPresets = presets;
        });
      },

      archiveConversation: async (id) => {
        const conversation = get().conversations[id];
        if (!conversation) return;
        const isLocalDraft = (
          !conversation.hasHistory
          && !conversation.sessionId
          && conversation.messages.length === 0
        );
        if (!isLocalDraft) {
          const status = await getNanobotStatus();
          if (!status.ready) {
            throw new Error('本地服务尚未就绪，暂时无法归档会话');
          }
          const token = getNanobotToken();
          const baseUrl = `http://127.0.0.1:${status.port}`;
          await archiveSession(token, conversationIdToSessionKey(id), baseUrl);
        }
        get().removeConversationLocally(id);
      },

      removeConversationLocally: (id) => {
        // Cancel any ongoing streaming for this conversation
        const controller = abortControllers.get(id);
        if (controller) {
          controller.abort();
          abortControllers.delete(id);
        }
        // Clean up per-conversation state in external modules
        clearTodos(id);
        clearInputQueue(id);
        useTaskExecutionStore.getState().clearConversation(id);
        useConversationWorkbenchStore.getState().clearConversation(id);
        useTurnPlanStore.getState().clearConversation(id);
        const wasActive = get().activeConversationId === id;
        set((state) => {
          delete state.conversations[id];
          removeConversationFromNavigation(state, id);
        });
        // Sync workspace to the newly active conversation
        if (wasActive) {
          const { activeConversationId, conversations } = get();
          const ws = useWorkspaceStore.getState();
          const nextConv = activeConversationId ? conversations[activeConversationId] : null;
          if (nextConv?.workspacePath) {
            ws.setWorkspace(nextConv.workspacePath);
          } else {
            ws.clearWorkspace();
          }
        }
      },

      renameConversation: (id, title) => {
        set((state) => {
          if (state.conversations[id]) {
            state.conversations[id].title = title;
          }
        });
      },

      addMessage: (convId, message) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (conv) {
            conv.messages.push(message);
            conv.updatedAt = Date.now();
            // Auto-title from first user message
            if (conv.title === '新对话' && message.role === 'user') {
              const content = typeof message.content === 'string'
                ? message.content
                : message.content.find(c => c.type === 'text')?.text || '';
              conv.title = content.slice(0, 30) + (content.length > 30 ? '...' : '');
            }
          }
        });
      },

      updateConversationMessages: (convId, updater) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (!conv) return;
          conv.messages = updater(conv.messages);
          conv.updatedAt = Date.now();
        });
      },

      appendToLastMessage: (convId, token) => {
        set((state) => {
          const messages = state.conversations[convId]?.messages;
          if (messages?.length) {
            const lastMsg = messages[messages.length - 1];
            if (typeof lastMsg.content === 'string') {
              lastMsg.content += token;
            }
          }
        });
      },

      appendToMessage: (convId, messageId, token) => {
        set((state) => {
          const msg = state.conversations[convId]?.messages.find((m) => m.id === messageId);
          if (msg && typeof msg.content === 'string') {
            msg.content += token;
          }
        });
      },

      setLastMessageContent: (convId, content) => {
        set((state) => {
          const messages = state.conversations[convId]?.messages;
          if (messages?.length) {
            const lastMsg = messages[messages.length - 1];
            lastMsg.content = content;
          }
        });
      },

      setMessageContent: (convId, messageId, content) => {
        set((state) => {
          const msg = state.conversations[convId]?.messages.find((m) => m.id === messageId);
          if (msg) {
            msg.content = content;
          }
        });
      },

      appendMessageMedia: (convId, messageId, media) => {
        if (media.length === 0) return;
        set((state) => {
          const msg = state.conversations[convId]?.messages.find((m) => m.id === messageId);
          if (!msg) return;
          const seen = new Set((msg.mediaAttachments ?? []).map((item) => item.path || item.url || item.name || ''));
          const next = media.filter((item) => {
            const key = item.path || item.url || item.name || '';
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          if (next.length === 0) return;
          msg.mediaAttachments = [...(msg.mediaAttachments ?? []), ...next];
        });
      },

      finishStreaming: (convId) => {
        set((state) => {
          const messages = state.conversations[convId]?.messages;
          if (messages?.length) {
            messages[messages.length - 1].isStreaming = false;
          }
          state.agentStatus = 'idle';
          state.currentTool = null;
        });
      },

      finishAllStreaming: (convId) => {
        set((state) => {
          const messages = state.conversations[convId]?.messages;
          if (messages?.length) {
            messages.forEach((message) => {
              if (message.isStreaming) message.isStreaming = false;
            });
          }
          state.agentStatus = 'idle';
          state.currentTool = null;
        });
      },

      updateToolCall: (convId, messageId, toolCallId, result, resultContent, isError, hideScreenshot) => {
        set((state) => {
          const msg = state.conversations[convId]?.messages.find((m) => m.id === messageId);
          if (msg?.toolCalls) {
            const tc = msg.toolCalls.find((t) => t.id === toolCallId);
            if (tc) {
              tc.result = result;
              if (resultContent) tc.resultContent = resultContent;
              if (isError) tc.isError = true;
              if (hideScreenshot != null) tc.hideScreenshot = hideScreenshot;
              tc.isExecuting = false;
            }
          }
        });
      },

      addToolCall: (convId, messageId, toolCall) => {
        set((state) => {
          const msg = state.conversations[convId]?.messages.find((m) => m.id === messageId);
          if (msg) {
            if (!msg.toolCalls) {
              msg.toolCalls = [];
            }
            if (!msg.toolCalls.some((c) => c.id === toolCall.id)) {
              msg.toolCalls.push(toolCall);
            }
          }
        });
      },

      upsertConversation: (id, conversation) => {
        set((state) => {
          state.conversations[id] = conversation;
        });
      },

      upsertConversations: (conversations) => {
        set((state) => {
          for (const [id, conversation] of Object.entries(conversations)) {
            state.conversations[id] = conversation;
          }
        });
      },

      reconcileGatewayConversations: (conversations) => {
        const gatewayIds = new Set(Object.keys(conversations));
        const staleIds = Object.values(get().conversations)
          .filter((conversation) => (
            conversation.hasHistory === true
            && conversation.status !== 'running'
            && !gatewayIds.has(conversation.id)
          ))
          .map((conversation) => conversation.id);
        const staleIdSet = new Set(staleIds);
        for (const id of staleIds) {
          const controller = abortControllers.get(id);
          if (controller) {
            controller.abort();
            abortControllers.delete(id);
          }
          clearTodos(id);
          clearInputQueue(id);
          useTaskExecutionStore.getState().clearConversation(id);
          useConversationWorkbenchStore.getState().clearConversation(id);
          useTurnPlanStore.getState().clearConversation(id);
        }
        const activeWasRemoved = staleIdSet.has(get().activeConversationId ?? '');
        set((state) => {
          for (const id of staleIds) {
            delete state.conversations[id];
          }
          state.conversationNavigationHistory = state.conversationNavigationHistory.filter(
            (id) => !staleIdSet.has(id) && state.conversations[id] !== undefined,
          );
          if (activeWasRemoved) {
            let previousId: string | null = null;
            while (state.conversationNavigationHistory.length > 0) {
              const candidate = state.conversationNavigationHistory.pop();
              if (candidate && state.conversations[candidate]) {
                previousId = candidate;
                break;
              }
            }
            state.activeConversationId = previousId;
          }
          for (const [id, conversation] of Object.entries(conversations)) {
            state.conversations[id] = conversation;
          }
        });
        if (activeWasRemoved) {
          const { activeConversationId, conversations: current } = get();
          const next = activeConversationId ? current[activeConversationId] : null;
          const workspace = useWorkspaceStore.getState();
          if (next?.workspacePath) workspace.setWorkspace(next.workspacePath);
          else workspace.clearWorkspace();
        }
      },

      // New message operations
      deleteMessage: (convId, messageId) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (conv) {
            conv.messages = conv.messages.filter((m) => m.id !== messageId);
            conv.updatedAt = Date.now();
            conv.contextCache = undefined;  // Invalidate compression cache
          }
        });
      },

      deleteMessagesFrom: (convId, messageId) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (conv) {
            const idx = conv.messages.findIndex((m) => m.id === messageId);
            if (idx !== -1) {
              conv.messages = conv.messages.slice(0, idx);
              conv.updatedAt = Date.now();
              conv.contextCache = undefined;  // Invalidate compression cache
            }
          }
        });
      },

      deleteLoopMessages: (convId, loopId) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (conv) {
            conv.messages = conv.messages.filter((m) => m.loopId !== loopId);
            conv.updatedAt = Date.now();
            conv.contextCache = undefined;  // Invalidate compression cache
          }
        });
      },

      updateMessageThinking: (convId, thinking) => {
        set((state) => {
          const messages = state.conversations[convId]?.messages;
          if (messages?.length) {
            messages[messages.length - 1].thinking = thinking;
          }
        });
      },

      updateMessageThinkingById: (convId, messageId, thinking) => {
        set((state) => {
          const msg = state.conversations[convId]?.messages.find((m) => m.id === messageId);
          if (msg) {
            msg.thinking = thinking;
          }
        });
      },

      updateMessageThinkingDuration: (convId, duration) => {
        set((state) => {
          const messages = state.conversations[convId]?.messages;
          if (messages?.length) {
            messages[messages.length - 1].thinkingDuration = duration;
          }
        });
      },

      updateMessageUsage: (convId, usage) => {
        set((state) => {
          const messages = state.conversations[convId]?.messages;
          if (messages?.length) {
            messages[messages.length - 1].usage = {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
            };
          }
        });
      },

      appendToolCallContext: (convId, loopId, context) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (!conv) return;
          // Find the last assistant message with this loopId (scan backward, no copy)
          for (let i = conv.messages.length - 1; i >= 0; i--) {
            const m = conv.messages[i];
            if (m.role === 'assistant' && m.loopId === loopId) {
              if (!m.toolCallsForContext) {
                m.toolCallsForContext = [];
              }
              m.toolCallsForContext.push(context);
              break;
            }
          }
        });
      },

      setExecutionStepsSnapshot: (convId, loopId, steps) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (!conv) return;
          // Find the last assistant message with this loopId (scan backward, no copy)
          for (let i = conv.messages.length - 1; i >= 0; i--) {
            const m = conv.messages[i];
            if (m.role === 'assistant' && m.loopId === loopId) {
              m.executionSteps = steps;
              break;
            }
          }
        });
      },

      // Streaming control
      getAbortController: (convId) => {
        let controller = abortControllers.get(convId);
        if (!controller) {
          controller = new AbortController();
          abortControllers.set(convId, controller);
        }
        return controller;
      },

      cancelStreaming: (convId) => {
        const controller = abortControllers.get(convId);
        if (controller) {
          controller.abort();
          abortControllers.delete(convId);
        }
        set((state) => {
          const messages = state.conversations[convId]?.messages;
          if (messages?.length) {
            const lastMsg = messages[messages.length - 1];
            if (lastMsg.isStreaming) {
              lastMsg.isStreaming = false;
              // Append cancellation notice
              if (typeof lastMsg.content === 'string') {
                lastMsg.content += '\n\n*[已停止]*';
              }
            }
            // Mark any executing tool calls as cancelled
            if (lastMsg.toolCalls) {
              lastMsg.toolCalls.forEach((tc) => {
                if (tc.isExecuting) {
                  tc.isExecuting = false;
                  tc.result = '[已取消]';
                }
              });
            }
          }
          state.agentStatus = 'idle';
          state.currentTool = null;
        });
      },

      clearAbortController: (convId) => {
        abortControllers.delete(convId);
      },

      setAgentStatus: (status, tool, agentName) => {
        set((state) => {
          state.agentStatus = status;
          state.currentTool = tool ?? null;
          // Track concurrent active agents
          if (agentName && status === 'tool-calling') {
            if (!state.activeAgentNames.includes(agentName)) {
              state.activeAgentNames.push(agentName);
            }
          }
          // Track thinking start time
          if (status === 'thinking') {
            state.thinkingStartTime = Date.now();
          } else if (status === 'idle') {
            state.thinkingStartTime = null;
            state.activeAgentNames = [];
          }
        });
      },

      removeActiveAgent: (agentName) => {
        set((state) => {
          state.activeAgentNames = state.activeAgentNames.filter(n => n !== agentName);
        });
      },

      setCurrentUsage: (usage) => {
        set((state) => {
          state.currentUsage = usage;
        });
      },

      setPendingInput: (text) => {
        set((state) => {
          state.pendingInput = text;
        });
      },

      setPendingExpertTeam: (team) => {
        set((state) => {
          state.pendingExpertTeam = team;
        });
      },

      setConversationStatus: (convId, status) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (conv) {
            conv.status = status;
            if (status === 'completed') {
              conv.completedAt = Date.now();
            } else {
              conv.completedAt = undefined;
            }
          }
        });
      },

      setConversationRuntimeSnapshot: (convId, snapshot) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (!conv) return;
          conv.runtimeSnapshot = snapshot;
          conv.status = snapshot.thread_status.type === 'active'
            ? 'running'
            : snapshot.thread_status.type === 'systemError'
              ? 'error'
              : 'idle';
          conv.completedAt = undefined;
        });
      },

      clearCompletedStatus: (convId) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (conv && conv.status === 'completed') {
            conv.status = 'idle';
            conv.completedAt = undefined;
          }
        });
      },

      // Toggle MCP server for per-session filter
      toggleMCPServer: (convId, serverName) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (!conv) return;
          const current = conv.enabledMCPServers;
          if (!current) {
            // First toggle: disable this server (start from "all enabled")
            conv.enabledMCPServers = [serverName];
          } else if (current.includes(serverName)) {
            conv.enabledMCPServers = current.filter((n) => n !== serverName);
            if (conv.enabledMCPServers.length === 0) {
              // Empty array = reset to "all enabled"
              conv.enabledMCPServers = undefined;
            }
          } else {
            conv.enabledMCPServers = [...current, serverName];
          }
        });
      },

      // Context compression cache
      setContextCache: (convId, cache) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (conv) conv.contextCache = cache;
        });
      },
      clearContextCache: (convId) => {
        set((state) => {
          const conv = state.conversations[convId];
          if (conv) conv.contextCache = undefined;
        });
      },

      // Export conversation as JSON string
      exportConversation: (convId: string): string | null => {
        const conversations = get().conversations;
        const conv = conversations[convId];
        if (!conv) return null;
        return JSON.stringify(conv, null, 2);
      },

      // Import conversation from JSON string, returns new conversation ID
      importConversation: (json: string) => {
        try {
          const conv = JSON.parse(json) as Conversation;
          if (!conv.id || !conv.messages) return null;

          // Generate new ID to avoid conflicts
          const newId = generateId();
          const imported: Conversation = {
            ...conv,
            id: newId,
            status: 'idle',
            completedAt: undefined,
          };

          // Clean up streaming states
          for (const msg of imported.messages) {
            msg.isStreaming = false;
            if (msg.toolCalls) {
              for (const tc of msg.toolCalls) {
                tc.isExecuting = false;
              }
            }
          }

          set((state) => {
            state.conversations[newId] = imported;
            activateConversation(state, newId);
          });
          // Sync workspace to imported conversation
          const ws = useWorkspaceStore.getState();
          if (imported.workspacePath) {
            ws.setWorkspace(imported.workspacePath);
          } else {
            ws.clearWorkspace();
          }

          return newId;
        } catch {
          return null;
        }
      },
    })),
    {
      name: 'ruyi-chat',
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        // v1 → v2: added executionSteps on Message (optional field, no-op migration)
        if (version < 2) { /* no transform needed */ }
        return state;
      },
      partialize: (state) => ({
        conversations: stripMessagesForPersist(state.conversations),
        // activeConversationId not persisted — app always starts on welcome screen
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // Reset running states and ephemeral fields
        for (const conv of Object.values(state.conversations)) {
          if (conv.status === 'running') {
            conv.status = 'idle';
          }
          conv.completedAt = undefined;
          conv.contextCache = undefined;  // Ephemeral — never restore from disk
          conv.messages = [];
        }

        // Limit total conversations (keep newest by updatedAt)
        const convEntries = Object.entries(state.conversations);
        if (convEntries.length > MAX_CONVERSATIONS) {
          convEntries.sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
          const toRemove = convEntries.slice(MAX_CONVERSATIONS);
          for (const [id] of toRemove) {
            delete state.conversations[id];
          }
          // Fix activeConversationId if removed (pick last = most recent).
          if (state.activeConversationId && !state.conversations[state.activeConversationId]) {
            const ids = Object.keys(state.conversations);
            state.activeConversationId = ids.length > 0 ? ids[ids.length - 1] : null;
          }
        }
      },
    }
  )
);

// Helper: get active conversation
export function useActiveConversation() {
  return useChatStore((s) => {
    const id = s.activeConversationId;
    return id ? s.conversations[id] : null;
  });
}
