import { describe, expect, it } from 'vitest';
import {
  AVAILABLE_MODELS,
  DEFAULT_FALLBACK_MODEL,
  getAvailableProviders,
  getEffectiveModel,
  useSettingsStore,
} from './settingsStore';

describe('settings model fallback', () => {
  it('uses DeepSeek Flash when a custom model is empty', () => {
    const state = {
      ...useSettingsStore.getState(),
      provider: 'custom' as const,
      model: '__custom__',
      customModel: '',
    };

    expect(getEffectiveModel(state)).toBe(DEFAULT_FALLBACK_MODEL);
    expect(DEFAULT_FALLBACK_MODEL).toBe('deepseek_v4_flash');
  });

  it('does not expose a built-in Anthropic model list', () => {
    expect(getAvailableProviders()).not.toContain('anthropic');
    expect((AVAILABLE_MODELS as Record<string, unknown>).anthropic).toBeUndefined();
  });

  it('rehydrates an unsupported backend provider without falling back to Claude', async () => {
    localStorage.setItem('ruyi-settings', JSON.stringify({
      version: 8,
      state: {
        provider: 'stepfun',
        apiFormat: 'openai-compatible',
        model: 'step-3.7-flash',
        customModel: '',
        apiKey: '********',
        baseUrl: 'https://example.invalid/v1',
      },
    }));

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState()).toMatchObject({
      provider: 'custom',
      apiFormat: 'openai-compatible',
      model: DEFAULT_FALLBACK_MODEL,
      customModel: DEFAULT_FALLBACK_MODEL,
      apiKey: '',
      baseUrl: '',
    });
  });
});
