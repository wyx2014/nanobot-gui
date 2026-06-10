import type { Message, TokenUsage, ImageAttachment } from '../../types';
import type { LLMAdapter } from '../llm/adapter';
import type { EventRouter } from '../agent/eventRouter';
import type { ConfirmationInfo, FilePermissionCallback } from '../tools/registry';

export interface AgentSession {
  conversationId: string;
  loopId: string;
  history: Message[];
  status: 'idle' | 'thinking' | 'tool-calling' | 'streaming' | 'completed' | 'error';
  usage: TokenUsage;
  images?: ImageAttachment[];
  abortController: AbortController;
}

export interface ExecutionContext {
  session: AgentSession;
  adapter: LLMAdapter;
  eventRouter: EventRouter;
  commandConfirmCallback: (info: ConfirmationInfo) => Promise<boolean>;
  filePermissionCallback: FilePermissionCallback;
}

export interface EngineOptions {
  maxTurns?: number;
  enableThinking?: boolean;
  thinkingBudget?: number;
  contextWindowSize?: number;
  maxOutputTokens?: number;
  loopId?: string;
  systemPrompt?: string;
}

export interface TurnResult {
  stopReason: 'end_turn' | 'max_turns' | 'aborted' | 'error' | 'delegate_complete';
  error?: string;
}
