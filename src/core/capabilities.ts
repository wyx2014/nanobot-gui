import { PROVIDER_CONFIGS } from '@/stores/settingsStore';
import type { LLMProvider, BuiltinSearchMethod } from '@/types';

/** Check if provider has built-in web search capability */
export function providerSupportsWebSearch(provider: LLMProvider): boolean {
  return !!PROVIDER_CONFIGS[provider]?.capabilities?.webSearch;
}

/** Check if provider has built-in image generation capability */
export function providerSupportsImageGen(provider: LLMProvider): boolean {
  return !!PROVIDER_CONFIGS[provider]?.capabilities?.imageGen;
}

/**
 * Get the built-in search config if provider supports it and user preference is enabled.
 * Returns undefined if provider doesn't support builtin search or user turned it off.
 */
export function getBuiltinSearchConfig(provider: LLMProvider, userPref: boolean): BuiltinSearchMethod | undefined {
  if (!userPref) return undefined;
  return PROVIDER_CONFIGS[provider]?.capabilities?.webSearch;
}
