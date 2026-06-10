import type { Message, TokenUsage } from '../../types';
import type { LLMAdapter } from '../llm/adapter';
import type { EventRouter } from '../agent/eventRouter';
import type { ConfirmationInfo, FilePermissionCallback } from '../tools/registry';
import type { AgentSession, ExecutionContext, EngineOptions } from './types';
import { ExecutionEngine } from './engine';
import { useChatStore } from '../../stores/chatStore';

export async function runAgentLoopV2(
  conversationId: string,
  adapter: LLMAdapter,
  eventRouter: EventRouter,
  commandConfirmCallback: (info: ConfirmationInfo) => Promise<boolean>,
  filePermissionCallback: FilePermissionCallback,
  route: any,
  options: EngineOptions = {}
) {
  const chatStore = useChatStore.getState();
  const conv = chatStore.conversations[conversationId];
  if (!conv) throw new Error(`Conversation ${conversationId} not found`);

  const abortController = new AbortController();
  const session: AgentSession = {
    conversationId,
    loopId: options.loopId || Date.now().toString(36),
    history: [...conv.messages],
    status: 'idle',
    usage: { inputTokens: 0, outputTokens: 0 },
    abortController,
  };

  const ctx: ExecutionContext = {
    session,
    adapter,
    eventRouter,
    commandConfirmCallback,
    filePermissionCallback,
  };

  const engine = new ExecutionEngine(ctx, options);
  
  chatStore.setAgentStatus('thinking');
  
  try {
    const result = await engine.run(route, session.history);
    
    // Final status and routing cleanup
    chatStore.setAgentStatus('idle');
    chatStore.setConversationStatus(conversationId, 'completed');
    
    // Route completion event to clear UI steps
    await eventRouter.route({ 
      type: 'done', 
      loopId: session.loopId, 
      reason: result.stopReason 
    });
    
    return result;
  } catch (err) {
    chatStore.setAgentStatus('idle');
    chatStore.setConversationStatus(conversationId, 'error');
    
    const errorMessage = err instanceof Error ? err.message : String(err);
    await eventRouter.route({ 
      type: 'error', 
      loopId: session.loopId, 
      error: errorMessage 
    });
    
    console.error('Agent Loop V2 Failed:', err);
    throw err;
  }
}
