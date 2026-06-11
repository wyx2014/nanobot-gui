/**
 * Context Compressor — LLM-based semantic summarization
 *
 * When the conversation context approaches the context window limit,
 * uses a fast LLM call to generate a semantic summary of older messages
 * instead of hard-truncating them.
 *
 * Strategy:
 * 1. Check if context usage > threshold (default 75%)
 * 2. Identify older messages that can be summarized (keep first + recent)
 * 3. Call LLM to generate a concise summary
 * 4. Replace older messages with a single summary message
 * 5. Fall back to hard truncation if LLM summarization fails
 */

import type { Message } from '../../types';
import { estimateTokens, estimateMessageTokens } from './tokenEstimator';
import { getMessageText, identifyRounds, RECENT_ROUNDS_TO_KEEP } from './contextUtils';

const COMPRESSION_THRESHOLD = 0.75; // Trigger at 75% context usage
const SUMMARY_MAX_TOKENS = 1024;

interface CompressionChatOptions {
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface CompressionAdapter {
  chat(
    messages: Message[],
    options: CompressionChatOptions,
    onEvent: (event: { type: string; text?: string }) => void,
  ): Promise<void>;
}

/** Configuration for context compression */
export interface CompressionConfig {
  adapter: CompressionAdapter;
  model: string;
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
}

/** Result of compression attempt */
export interface CompressionResult {
  messages: Message[];
  compressed: boolean;
  savedTokens: number;
  extractedMemories?: string[]; // New: Memories extracted for durable storage
}

/**
 * Build a text representation of messages for the summarization prompt
 */
function messagesToText(messages: Message[]): string {
  return messages.map((msg) => {
    const role = msg.role === 'user' ? '用户' : '助手';
    const text = getMessageText(msg.content);
    const toolNames = msg.toolCalls?.map(tc => tc.name).join(', ');
    const toolResults = msg.toolCallsForContext?.map(tc =>
      `[${tc.name}: ${tc.result.slice(0, 100)}${tc.result.length > 100 ? '...' : ''}]`
    ).join(', ');

    let line = `${role}: ${text}`;
    if (toolNames) line += ` [调用工具: ${toolNames}]`;
    if (toolResults) line += ` [工具结果: ${toolResults}]`;
    return line;
  }).join('\n');
}

/**
 * Check if context needs compression and compress if needed.
 *
 * Returns compressed messages if compression was performed, or original messages if not needed.
 * Falls back gracefully on LLM errors — never blocks the agent loop.
 */
export async function compressContextIfNeeded(
  messages: Message[],
  systemPrompt: string,
  contextWindowSize: number,
  reserveForOutput: number,
  config: CompressionConfig
): Promise<CompressionResult> {
  const maxInputTokens = contextWindowSize - reserveForOutput;
  const systemTokens = estimateTokens(systemPrompt);
  const messageTokens = estimateMessageTokens(messages);
  const totalTokens = systemTokens + messageTokens;

  // Check if compression is needed
  if (totalTokens <= maxInputTokens * COMPRESSION_THRESHOLD) {
    return { messages, compressed: false, savedTokens: 0 };
  }

  const rounds = identifyRounds(messages);
  if (rounds.length <= RECENT_ROUNDS_TO_KEEP + 1) {
    // Not enough rounds to compress
    return { messages, compressed: false, savedTokens: 0 };
  }

  // Split into: first round (task context) + middle (to summarize) + recent (to keep)
  const firstRound = rounds[0];
  const recentRounds = rounds.slice(-RECENT_ROUNDS_TO_KEEP);
  const middleRounds = rounds.slice(1, -RECENT_ROUNDS_TO_KEEP);

  if (middleRounds.length === 0) {
    return { messages, compressed: false, savedTokens: 0 };
  }

  const middleMessages = middleRounds.flat();
  const middleTokens = estimateMessageTokens(middleMessages);

  // Only compress if middle messages are substantial enough to be worth it
  if (middleTokens < 500) {
    return { messages, compressed: false, savedTokens: 0 };
  }

  try {
    // Generate summary using LLM
    const middleText = messagesToText(middleMessages);

    const summaryPrompt = `请对以下对话内容进行“预压缩冲刷（Memory Flush）”。
你需要完成两个任务：

任务 1：提取持久记忆 (Durable Memories)
从对话中提取出值得永久保存的关键信息（每条信息一行，以 "- [MEMORY]" 开头）。
关注点：用户的长期偏好、已确定的项目路径、重要的技术结论、解决过的疑难 Bug 根因。
如果没有值得保存的信息，请忽略此项。

任务 2：生成对话摘要
将对话内容压缩为一段简洁的内容概要，供后续对话理解背景。

对话内容：
${middleText}

请按以下格式输出：
[EXTRACTED_MEMORIES]
- [MEMORY] {记忆内容1}
- [MEMORY] {记忆内容2}
[END_EXTRACTED_MEMORIES]

[SUMMARY]
{此处填写对话摘要}
[END_SUMMARY]`;

    const summaryMessages: Message[] = [{
      id: 'compress-prompt',
      role: 'user',
      content: summaryPrompt,
      timestamp: Date.now(),
    }];

    let fullResponse = '';
    const chatOptions: CompressionChatOptions = {
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      maxTokens: SUMMARY_MAX_TOKENS,
      signal: config.signal,
    };

    await config.adapter.chat(summaryMessages, chatOptions, (event) => {
      if (event.type === 'text') {
        fullResponse += event.text;
      }
    });

    if (!fullResponse.trim()) {
      // LLM returned empty — fall back
      return { messages, compressed: false, savedTokens: 0 };
    }

    // Parse memories and summary
    const memoryMatch = fullResponse.match(/\[EXTRACTED_MEMORIES\]([\s\S]*?)\[END_EXTRACTED_MEMORIES\]/);
    const summaryMatch = fullResponse.match(/\[SUMMARY\]([\s\S]*?)\[END_SUMMARY\]/);

    const extractedMemories = memoryMatch 
      ? memoryMatch[1].split('\n')
          .filter(line => line.includes('- [MEMORY]'))
          .map(line => line.replace('- [MEMORY]', '').trim())
          .filter(Boolean)
      : [];

    const summaryText = summaryMatch ? summaryMatch[1].trim() : fullResponse.trim();

    if (!summaryText) {
      return { messages, compressed: false, savedTokens: 0 };
    }

    // Build compressed message array
    const summaryMessage: Message = {
      id: `context-summary-${Date.now().toString(36)}`,
      role: 'user',
      content: `[对话历史摘要]\n${summaryText}`,
      timestamp: middleMessages[0]?.timestamp ?? Date.now(),
    };

    const compressedMessages = [
      ...firstRound,
      summaryMessage,
      ...recentRounds.flat(),
    ];

    const compressedTokens = estimateMessageTokens(compressedMessages);
    const savedTokens = messageTokens - compressedTokens;

    return {
      messages: compressedMessages,
      compressed: true,
      savedTokens: Math.max(0, savedTokens),
      extractedMemories: extractedMemories.length > 0 ? extractedMemories : undefined,
    };
  } catch {
    // LLM call failed — fall back gracefully, don't block the agent
    return { messages, compressed: false, savedTokens: 0 };
  }
}
