import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChatStore } from './chatStore';

const apiMocks = vi.hoisted(() => ({
  archiveSession: vi.fn(),
}));

const nanobotClientMocks = vi.hoisted(() => ({
  getNanobotStatus: vi.fn(),
  getNanobotToken: vi.fn(),
}));

vi.mock('@/core/api', () => apiMocks);
vi.mock('@/core/nanobotClient', () => nanobotClientMocks);

// Mock workspaceStore to avoid cross-store side effects
vi.mock('./workspaceStore', () => ({
  useWorkspaceStore: {
    getState: () => ({
      setWorkspace: vi.fn(),
      clearWorkspace: vi.fn(),
    }),
  },
}));

describe('chatStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      conversations: {},
      activeConversationId: null,
      conversationNavigationHistory: [],
      agentStatus: 'idle',
      currentTool: null,
      currentUsage: null,
      pendingInput: null,
      pendingExpertTeam: null,
      thinkingStartTime: null,
    });
  });

  describe('archiveConversation', () => {
    it('keeps a durable conversation when the gateway rejects archival', async () => {
      const id = useChatStore.getState().createConversation(null, { id: 'reminder-chat' });
      useChatStore.getState().upsertConversation(id, {
        ...useChatStore.getState().conversations[id],
        hasHistory: true,
      });
      nanobotClientMocks.getNanobotStatus.mockResolvedValue({ ready: true, port: 8900 });
      nanobotClientMocks.getNanobotToken.mockReturnValue('gateway-token');
      apiMocks.archiveSession.mockRejectedValue(new Error('该会话仍关联自动化任务'));

      await expect(
        useChatStore.getState().archiveConversation(id),
      ).rejects.toThrow('该会话仍关联自动化任务');

      expect(useChatStore.getState().conversations[id]).toBeDefined();
    });
  });

  // ── createConversation ──
  describe('createConversation', () => {
    it('creates a conversation and sets it active', () => {
      const id = useChatStore.getState().createConversation();
      const state = useChatStore.getState();
      expect(state.conversations[id]).toBeDefined();
      expect(state.conversations[id].title).toBe('新对话');
      expect(state.activeConversationId).toBe(id);
    });

    it('creates conversation with workspace path', () => {
      const id = useChatStore.getState().createConversation('/Users/test/project');
      expect(useChatStore.getState().conversations[id].workspacePath).toBe('/Users/test/project');
    });

    it('uses an initial title when provided', () => {
      const id = useChatStore.getState().createConversation(null, { title: '美伊战争经济影响报告' });
      expect(useChatStore.getState().conversations[id].title).toBe('美伊战争经济影响报告');
    });

    it('uses an authoritative gateway id when provided', () => {
      const id = useChatStore.getState().createConversation(null, { id: 'gateway-chat-id' });
      expect(id).toBe('gateway-chat-id');
      expect(useChatStore.getState().activeConversationId).toBe('gateway-chat-id');
      expect(useChatStore.getState().conversations['gateway-chat-id']).toBeDefined();
    });
  });

  // ── startNewConversation ──
  describe('startNewConversation', () => {
    it('sets activeConversationId to null', () => {
      useChatStore.getState().createConversation();
      useChatStore.getState().startNewConversation();
      expect(useChatStore.getState().activeConversationId).toBeNull();
    });

    it('opens the welcome composer with an expert team preselected without creating a conversation', () => {
      useChatStore.getState().createConversation(null, { id: 'existing' });

      useChatStore.getState().startNewConversation({
        expertTeam: {
          id: 'asset-research-team',
          name: '资产投研团队 · 个股研究',
          version: '1.0.0',
          member_count: 5,
        },
      });

      const state = useChatStore.getState();
      expect(state.activeConversationId).toBeNull();
      expect(Object.keys(state.conversations)).toEqual(['existing']);
      expect(state.pendingExpertTeam?.id).toBe('asset-research-team');
    });

    it('clears a preselected team when the user starts a regular new conversation', () => {
      useChatStore.getState().setPendingExpertTeam({
        id: 'asset-research-team',
        name: '资产投研团队 · 个股研究',
        version: '1.0.0',
        member_count: 5,
      });

      useChatStore.getState().startNewConversation();

      expect(useChatStore.getState().pendingExpertTeam).toBeNull();
    });

    it('consumes the welcome team selection after creating the real conversation', () => {
      useChatStore.getState().setPendingExpertTeam({
        id: 'asset-research-team',
        name: '资产投研团队 · 个股研究',
        version: '1.0.0',
        member_count: 5,
      });

      const id = useChatStore.getState().createConversation(null, {
        id: 'gateway-chat',
        expertTeam: useChatStore.getState().pendingExpertTeam,
      });

      expect(useChatStore.getState().conversations[id].expertTeam?.id).toBe('asset-research-team');
      expect(useChatStore.getState().pendingExpertTeam).toBeNull();
    });
  });

  // ── switchConversation ──
  describe('switchConversation', () => {
    it('switches active conversation', () => {
      const id1 = useChatStore.getState().createConversation();
      useChatStore.getState().createConversation();
      useChatStore.getState().switchConversation(id1);
      expect(useChatStore.getState().activeConversationId).toBe(id1);
    });
  });

  // ── removeConversationLocally ──
  describe('removeConversationLocally', () => {
    it('removes a conversation from the renderer cache', () => {
      const id = useChatStore.getState().createConversation();
      useChatStore.getState().removeConversationLocally(id);
      expect(useChatStore.getState().conversations[id]).toBeUndefined();
    });

    it('returns to the previously loaded conversation when active is deleted', () => {
      const id1 = useChatStore.getState().createConversation(null, { id: 'first' });
      useChatStore.getState().createConversation(null, { id: 'second' });
      useChatStore.getState().createConversation(null, { id: 'third' });
      useChatStore.getState().switchConversation(id1);
      useChatStore.getState().switchConversation('second');
      useChatStore.getState().removeConversationLocally('second');

      const state = useChatStore.getState();
      expect(state.activeConversationId).toBe(id1);
    });

    it('opens the new task page when no previously loaded conversation exists', () => {
      useChatStore.getState().createConversation(null, {
        id: 'never-loaded',
        skipActivate: true,
      });
      useChatStore.getState().createConversation(null, { id: 'only-loaded' });

      useChatStore.getState().removeConversationLocally('only-loaded');

      const state = useChatStore.getState();
      expect(state.activeConversationId).toBeNull();
      expect(state.conversations['never-loaded']).toBeDefined();
    });

    it('keeps the current page when a non-active conversation is deleted', () => {
      useChatStore.getState().createConversation(null, { id: 'active' });
      useChatStore.getState().createConversation(null, {
        id: 'background',
        skipActivate: true,
      });

      useChatStore.getState().removeConversationLocally('background');

      expect(useChatStore.getState().activeConversationId).toBe('active');
    });

    it('skips deleted entries while walking back through navigation history', () => {
      useChatStore.getState().createConversation(null, { id: 'first' });
      useChatStore.getState().createConversation(null, { id: 'second' });
      useChatStore.getState().createConversation(null, { id: 'third' });
      useChatStore.getState().removeConversationLocally('second');

      useChatStore.getState().removeConversationLocally('third');

      expect(useChatStore.getState().activeConversationId).toBe('first');
    });
  });

  describe('reconcileGatewayConversations', () => {
    it('removes stale durable rows while preserving local drafts', () => {
      useChatStore.getState().upsertConversation('stale', {
        id: 'stale',
        title: 'Archived elsewhere',
        messages: [],
        createdAt: 1,
        updatedAt: 2,
        status: 'idle',
        hasHistory: true,
      });
      useChatStore.getState().upsertConversation('draft', {
        id: 'draft',
        title: 'Local draft',
        messages: [],
        createdAt: 2,
        updatedAt: 3,
        status: 'idle',
      });
      useChatStore.getState().reconcileGatewayConversations({
        current: {
          id: 'current',
          title: 'Current',
          messages: [],
          createdAt: 3,
          updatedAt: 4,
          status: 'idle',
          hasHistory: true,
        },
      });

      const conversations = useChatStore.getState().conversations;
      expect(conversations.stale).toBeUndefined();
      expect(conversations.draft).toBeDefined();
      expect(conversations.current).toBeDefined();
    });

    it('removes stale history in one reconciliation and keeps valid navigation', () => {
      for (const id of ['kept', 'stale-a', 'stale-b']) {
        useChatStore.getState().createConversation(null, { id });
        useChatStore.getState().upsertConversation(id, {
          ...useChatStore.getState().conversations[id],
          hasHistory: true,
        });
      }
      expect(useChatStore.getState().activeConversationId).toBe('stale-b');

      useChatStore.getState().reconcileGatewayConversations({
        kept: useChatStore.getState().conversations.kept,
      });

      const state = useChatStore.getState();
      expect(Object.keys(state.conversations)).toEqual(['kept']);
      expect(state.activeConversationId).toBe('kept');
      expect(state.conversationNavigationHistory).toEqual([]);
    });
  });

  // ── renameConversation ──
  describe('renameConversation', () => {
    it('renames a conversation', () => {
      const id = useChatStore.getState().createConversation();
      useChatStore.getState().renameConversation(id, '测试对话');
      expect(useChatStore.getState().conversations[id].title).toBe('测试对话');
    });
  });

  // ── addMessage ──
  describe('addMessage', () => {
    it('adds a message to conversation', () => {
      const id = useChatStore.getState().createConversation();
      useChatStore.getState().addMessage(id, {
        id: 'msg1', role: 'user', content: 'Hello', timestamp: Date.now(),
      });
      const conv = useChatStore.getState().conversations[id];
      expect(conv.messages).toHaveLength(1);
      expect(conv.messages[0].content).toBe('Hello');
    });

    it('auto-titles from first user message', () => {
      const id = useChatStore.getState().createConversation();
      useChatStore.getState().addMessage(id, {
        id: 'msg1', role: 'user', content: '帮我写一个函数', timestamp: Date.now(),
      });
      const title = useChatStore.getState().conversations[id].title;
      expect(title).toContain('帮我写一个函数');
    });

    it('truncates long auto-titles to 30 chars', () => {
      const id = useChatStore.getState().createConversation();
      useChatStore.getState().addMessage(id, {
        id: 'msg1', role: 'user', content: 'x'.repeat(50), timestamp: Date.now(),
      });
      const title = useChatStore.getState().conversations[id].title;
      expect(title.length).toBeLessThanOrEqual(34); // 30 + "..."
    });
  });

  // ── appendToLastMessage ──
  describe('appendToLastMessage', () => {
    it('appends token to last message', () => {
      const id = useChatStore.getState().createConversation();
      useChatStore.getState().addMessage(id, {
        id: 'msg1', role: 'assistant', content: 'Hello', timestamp: Date.now(),
      });
      useChatStore.getState().appendToLastMessage(id, ' World');
      const msg = useChatStore.getState().conversations[id].messages[0];
      expect(msg.content).toBe('Hello World');
    });
  });

  // ── finishStreaming ──
  describe('finishStreaming', () => {
    it('sets isStreaming to false and resets agent status', () => {
      const id = useChatStore.getState().createConversation();
      useChatStore.getState().addMessage(id, {
        id: 'msg1', role: 'assistant', content: 'Hi', timestamp: Date.now(), isStreaming: true,
      });
      useChatStore.getState().finishStreaming(id);
      const state = useChatStore.getState();
      expect(state.conversations[id].messages[0].isStreaming).toBe(false);
      expect(state.agentStatus).toBe('idle');
    });
  });

  // ── deleteMessage ──
  describe('deleteMessage', () => {
    it('removes a specific message', () => {
      const id = useChatStore.getState().createConversation();
      useChatStore.getState().addMessage(id, { id: 'msg1', role: 'user', content: 'a', timestamp: 1 });
      useChatStore.getState().addMessage(id, { id: 'msg2', role: 'assistant', content: 'b', timestamp: 2 });
      useChatStore.getState().deleteMessage(id, 'msg1');
      expect(useChatStore.getState().conversations[id].messages).toHaveLength(1);
      expect(useChatStore.getState().conversations[id].messages[0].id).toBe('msg2');
    });
  });

  // ── deleteMessagesFrom ──
  describe('deleteMessagesFrom', () => {
    it('deletes from a message onwards', () => {
      const id = useChatStore.getState().createConversation();
      useChatStore.getState().addMessage(id, { id: 'msg1', role: 'user', content: 'a', timestamp: 1 });
      useChatStore.getState().addMessage(id, { id: 'msg2', role: 'assistant', content: 'b', timestamp: 2 });
      useChatStore.getState().addMessage(id, { id: 'msg3', role: 'user', content: 'c', timestamp: 3 });
      useChatStore.getState().deleteMessagesFrom(id, 'msg2');
      expect(useChatStore.getState().conversations[id].messages).toHaveLength(1);
    });
  });

  // ── setAgentStatus ──
  describe('setAgentStatus', () => {
    it('sets thinking status with timestamp', () => {
      useChatStore.getState().setAgentStatus('thinking');
      const state = useChatStore.getState();
      expect(state.agentStatus).toBe('thinking');
      expect(state.thinkingStartTime).not.toBeNull();
    });

    it('clears thinking timestamp on idle', () => {
      useChatStore.getState().setAgentStatus('thinking');
      useChatStore.getState().setAgentStatus('idle');
      expect(useChatStore.getState().thinkingStartTime).toBeNull();
    });

    it('sets tool name', () => {
      useChatStore.getState().setAgentStatus('tool-calling', 'read_file');
      expect(useChatStore.getState().currentTool).toBe('read_file');
    });
  });

  // ── setConversationStatus ──
  describe('setConversationStatus', () => {
    it('sets status to completed with completedAt', () => {
      const id = useChatStore.getState().createConversation();
      useChatStore.getState().setConversationStatus(id, 'completed');
      const conv = useChatStore.getState().conversations[id];
      expect(conv.status).toBe('completed');
      expect(conv.completedAt).toBeDefined();
    });

    it('clearCompletedStatus resets to idle', () => {
      const id = useChatStore.getState().createConversation();
      useChatStore.getState().setConversationStatus(id, 'completed');
      useChatStore.getState().clearCompletedStatus(id);
      const conv = useChatStore.getState().conversations[id];
      expect(conv.status).toBe('idle');
      expect(conv.completedAt).toBeUndefined();
    });
  });

  // ── export/import ──
  describe('export/import', () => {
    it('exports conversation as JSON', () => {
      const id = useChatStore.getState().createConversation();
      useChatStore.getState().addMessage(id, {
        id: 'msg1', role: 'user', content: 'Test', timestamp: Date.now(),
      });
      const json = useChatStore.getState().exportConversation(id);
      expect(json).not.toBeNull();
      const parsed = JSON.parse(json!);
      expect(parsed.messages).toHaveLength(1);
    });

    it('returns null for unknown conversation', () => {
      expect(useChatStore.getState().exportConversation('unknown')).toBeNull();
    });

    it('imports conversation with new ID', () => {
      const id = useChatStore.getState().createConversation();
      useChatStore.getState().addMessage(id, {
        id: 'msg1', role: 'user', content: 'Imported', timestamp: Date.now(),
      });
      const json = useChatStore.getState().exportConversation(id)!;
      const newId = useChatStore.getState().importConversation(json);
      expect(newId).not.toBeNull();
      expect(newId).not.toBe(id);
      expect(useChatStore.getState().conversations[newId!].messages[0].content).toBe('Imported');
    });

    it('returns null for invalid JSON', () => {
      expect(useChatStore.getState().importConversation('not json')).toBeNull();
    });
  });

  // ── setPendingInput ──
  describe('setPendingInput', () => {
    it('sets and clears pending input', () => {
      useChatStore.getState().setPendingInput('test input');
      expect(useChatStore.getState().pendingInput).toBe('test input');
      useChatStore.getState().setPendingInput(null);
      expect(useChatStore.getState().pendingInput).toBeNull();
    });
  });
});
