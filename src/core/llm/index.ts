import { useSettingsStore, getEffectiveModel } from '../../stores/settingsStore';
import type { LLMAdapter, ChatOptions } from './adapter';
import { ClaudeAdapter } from './claude';
import { OpenAICompatibleAdapter } from './openai-compatible';

/**
 * Factory to get the current LLM adapter and default options based on global settings.
 */
export function getLLMAdapter(): LLMAdapter {
  const settings = useSettingsStore.getState();
  if (settings.apiFormat === 'anthropic') {
    return new ClaudeAdapter();
  }
  return new OpenAICompatibleAdapter();
}

/**
 * Get current chat options from global settings.
 */
export function getCurrentChatOptions(): ChatOptions {
  const settings = useSettingsStore.getState();
  return {
    model: getEffectiveModel(settings),
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    temperature: settings.temperature,
    enableThinking: settings.enableThinking,
    thinkingBudget: settings.thinkingBudget,
    maxTokens: settings.maxOutputTokens,
  };
}
