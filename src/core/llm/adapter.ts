import type { StreamEvent, Message, ToolDefinition, BuiltinSearchMethod } from '../../types';

// Tool choice configuration for API requests
export type ToolChoice =
  | { type: 'auto' }           // Let model decide (default)
  | { type: 'any' }            // Force use any tool
  | { type: 'tool'; name: string }; // Force use specific tool

export interface ChatOptions {
  model: string;
  apiKey: string;
  baseUrl?: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  // New parameters for enhanced control
  toolChoice?: ToolChoice;
  temperature?: number;        // 0-1, controls randomness
  topP?: number;               // 0-1, nucleus sampling
  stopSequences?: string[];    // Custom stop sequences
  metadata?: {
    userId?: string;           // For tracking/analytics
  };
  // Extended thinking support (Claude Opus 4+)
  enableThinking?: boolean;
  thinkingBudget?: number;     // Max tokens for thinking
  // Whether the model supports vision (image inputs)
  supportsVision?: boolean;
  // Built-in web search method to inject into the request
  builtinWebSearch?: BuiltinSearchMethod;
  // Embedding specific options
  embeddingModel?: string;
  embeddingApiKey?: string;
  embeddingBaseUrl?: string;
  // Abort controller for cancellation
  signal?: AbortSignal;
}

export interface LLMAdapter {
  chat(
    messages: Message[],
    options: ChatOptions,
    onEvent: (event: StreamEvent) => void
  ): Promise<void>;

  embed(
    text: string,
    options: ChatOptions
  ): Promise<number[]>;
}

// --- Error Classification ---

export type LLMErrorCode =
  | 'rate_limit'           // 429
  | 'overloaded'           // 529 / 503
  | 'context_too_long'     // 400 with context length error
  | 'invalid_request'      // 400 other
  | 'authentication'       // 401 / 403
  | 'not_found'            // 404
  | 'server_error'         // 500 / 502
  | 'network_error'        // fetch/connection failures
  | 'cancelled'            // user abort
  | 'unknown';

export class LLMError extends Error {
  code: LLMErrorCode;
  retryable: boolean;
  retryAfterMs?: number;
  statusCode?: number;

  constructor(
    message: string,
    code: LLMErrorCode,
    options?: { retryable?: boolean; retryAfterMs?: number; statusCode?: number }
  ) {
    super(message);
    this.name = 'LLMError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.retryAfterMs = options?.retryAfterMs;
    this.statusCode = options?.statusCode;
  }
}

/**
 * Classify an HTTP status code and error message into an LLMError
 */
export function classifyError(statusCode: number, message: string): LLMError {
  // Rate limiting
  if (statusCode === 429) {
    const retryAfter = extractRetryAfter(message);
    return new LLMError(message, 'rate_limit', {
      retryable: true,
      retryAfterMs: retryAfter,
      statusCode,
    });
  }

  // Overloaded
  if (statusCode === 529 || statusCode === 503) {
    return new LLMError(message, 'overloaded', {
      retryable: true,
      retryAfterMs: 5000,
      statusCode,
    });
  }

  // Server errors (retryable)
  if (statusCode === 500 || statusCode === 502) {
    return new LLMError(message, 'server_error', {
      retryable: true,
      retryAfterMs: 2000,
      statusCode,
    });
  }

  // Auth errors (not retryable)
  if (statusCode === 401 || statusCode === 403) {
    return new LLMError(message, 'authentication', {
      retryable: false,
      statusCode,
    });
  }

  // Not found
  if (statusCode === 404) {
    return new LLMError(message, 'not_found', {
      retryable: false,
      statusCode,
    });
  }

  // Bad request — check for context length
  if (statusCode === 400) {
    const isContextTooLong = /prompt.is.too.long|token.*exceed|too.many.tokens|max.tokens.exceeded|context.window|context.length/i.test(message);
    if (isContextTooLong) {
      return new LLMError(message, 'context_too_long', {
        retryable: false,
        statusCode,
      });
    }
    return new LLMError(message, 'invalid_request', {
      retryable: false,
      statusCode,
    });
  }

  return new LLMError(message, 'unknown', { retryable: false, statusCode });
}

function extractRetryAfter(message: string): number | undefined {
  const match = message.match(/retry.after[:\s]*(\d+)/i);
  if (match) return parseInt(match[1], 10) * 1000;
  return undefined;
}

