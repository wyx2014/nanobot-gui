import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/tpacowork-test'),
  },
}));

import {
  buildDesktopDefaultMcpServers,
  buildDesktopDefaultModelConfig,
  buildDesktopManagedModelPatch,
  buildDesktopVoiceCleanupPatch,
} from './nanobotConfig';

describe('desktop default MCP servers', () => {
  const emptyCredentials = {
    juyuanToken: '',
    caihuiApiKey: '',
    ifindApiKey: '',
    anysearchApiKey: '',
  };

  it('contains the built-in finance connectors without embedding keys', () => {
    const servers = buildDesktopDefaultMcpServers(
      '/tmp/tpacowork-test/.nanobot',
      emptyCredentials,
    );

    expect(Object.keys(servers)).toEqual([
      'juyuan',
      'caihui_mcp',
      'hexin-ifind-ds-stock-mcp',
      'hexin-ifind-ds-fund-mcp',
      'hexin-ifind-ds-edb-mcp',
      'hexin-ifind-ds-news-mcp',
      'hexin-ifind-ds-bond-mcp',
      'hexin-ifind-ds-global-stock-mcp',
      'hexin-ifind-ds-index-mcp',
      'anysearch',
      'playwright',
    ]);
    expect(servers.juyuan).toMatchObject({
      type: 'streamableHttp',
      url: '',
      connectTimeout: 10,
    });
    expect(servers.caihui_mcp).toMatchObject({ url: '', headers: {} });
    expect(servers['hexin-ifind-ds-stock-mcp']).toMatchObject({ url: '', headers: {} });
    expect(servers.anysearch).toMatchObject({ url: '', headers: {} });
    expect(servers.playwright).toMatchObject({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@0.0.78'],
      cwd: path.join('/tmp/tpacowork-test/.nanobot', 'mcp', 'playwright'),
    });
  });

  it('uses explicitly provisioned connector keys', () => {
    const servers = buildDesktopDefaultMcpServers('/tmp/tpacowork-test/.nanobot', {
      juyuanToken: 'token with spaces',
      caihuiApiKey: 'caihui-key',
      ifindApiKey: 'ifind-key',
      anysearchApiKey: 'anysearch-key',
    });

    expect(servers.juyuan.url).toBe(
      'https://api.gildata.com/mcp-servers/aidata-assistant-srv-api?token=token%20with%20spaces',
    );
    expect(servers.caihui_mcp).toMatchObject({
      url: 'https://mcp.finchina.com/finchina-data-mcp-server/mcp',
      headers: { 'x-api-key': 'caihui-key' },
    });
    expect(servers['hexin-ifind-ds-index-mcp']).toMatchObject({
      url: 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-index-mcp',
      headers: { Authorization: 'ifind-key' },
    });
    expect(servers.anysearch).toMatchObject({
      url: 'https://api.anysearch.com/mcp',
      headers: { Authorization: 'Bearer anysearch-key' },
    });
  });
});

describe('desktop default model service', () => {
  const service = {
    providerId: 'asset-deepseek',
    providerLabel: '资产DeepSeek',
    apiKey: 'test-key',
    apiBase: 'http://model.test/v1/',
    apiType: 'auto' as const,
    model: 'deepseek-r1',
    presetId: 'asset-deepseek-r1',
  };

  it('creates a custom provider, text preset, and matching defaults', () => {
    const config = buildDesktopDefaultModelConfig(service);

    expect(config.providers['asset-deepseek']).toEqual({
      label: '资产DeepSeek',
      apiKey: 'test-key',
      apiBase: 'http://model.test/v1',
      apiType: 'auto',
    });
    expect(config.model_presets['asset-deepseek-r1']).toMatchObject({
      provider: 'asset-deepseek',
      model: 'deepseek-r1',
      capabilities: ['text'],
    });
    expect(config.model_defaults.text).toBe('asset-deepseek-r1');
    expect(config.agents.defaults).toMatchObject({
      modelPreset: 'asset-deepseek-r1',
      model: 'deepseek-r1',
      provider: 'asset-deepseek',
    });
  });

  it('installs and activates the managed service for an empty profile', () => {
    const patch = buildDesktopManagedModelPatch({}, service);

    expect(patch.providers['asset-deepseek']).toMatchObject({
      label: '资产DeepSeek',
      apiKey: 'test-key',
      apiBase: 'http://model.test/v1',
    });
    expect(patch.model_presets['asset-deepseek-r1']).toMatchObject({
      provider: 'asset-deepseek',
      model: 'deepseek-r1',
    });
    expect(patch.model_defaults?.text).toBe('asset-deepseek-r1');
    expect(patch.agents?.defaults.modelPreset).toBe('asset-deepseek-r1');
  });

  it('adds the managed service without replacing an existing valid default', () => {
    const patch = buildDesktopManagedModelPatch({
      providers: { custom: { apiKey: 'old-key' } },
      modelPresets: {
        existing: { provider: 'custom', model: 'old-model' },
      },
      modelDefaults: { text: 'existing' },
      agents: { defaults: { model: 'old-model', provider: 'custom' } },
    }, service);

    expect(patch.providers).toHaveProperty('asset-deepseek');
    expect(patch.model_presets).toHaveProperty('asset-deepseek-r1');
    expect(patch.model_presets).toHaveProperty('existing');
    expect(patch.model_defaults).toEqual({ text: 'existing' });
    expect(patch).not.toHaveProperty('agents');
  });

  it('replaces an orphaned implicit model that has no configured provider', () => {
    const patch = buildDesktopManagedModelPatch({
      providers: {
        minimax: { apiKey: null, apiBase: null },
      },
      model_presets: {},
      model_defaults: { text: 'default' },
      agents: {
        defaults: {
          modelPreset: null,
          model: 'minimaxai/minimax-m2.7',
          provider: 'auto',
        },
      },
    }, service);

    expect(patch.model_defaults?.text).toBe('asset-deepseek-r1');
    expect(patch.agents?.defaults).toMatchObject({
      modelPreset: 'asset-deepseek-r1',
      model: 'deepseek-r1',
      provider: 'asset-deepseek',
    });
  });

  it('keeps later user defaults and provider edits once the service exists', () => {
    const patch = buildDesktopManagedModelPatch({
      providers: {
        'asset-deepseek': { apiKey: 'stale-key', apiBase: 'http://old.test/v1' },
        custom: { apiKey: 'preferred-key' },
      },
      modelPresets: {
        'asset-deepseek-r1': { provider: 'asset-deepseek', model: 'deepseek-r1' },
        preferred: { provider: 'custom', model: 'preferred-model' },
      },
      modelDefaults: { text: 'preferred' },
      agents: { defaults: { model: 'preferred-model', provider: 'custom' } },
    }, service);

    expect(patch.providers).toEqual({});
    expect(patch.model_presets).toEqual({
      'asset-deepseek-r1': { provider: 'asset-deepseek', model: 'deepseek-r1' },
      preferred: { provider: 'custom', model: 'preferred-model' },
    });
    expect(patch.model_defaults).toEqual({ text: 'preferred' });
    expect(patch).not.toHaveProperty('agents');
  });

  it('migrates duplicate camelCase root aliases into canonical snake_case keys', () => {
    const patch = buildDesktopManagedModelPatch({
      providers: {
        'asset-deepseek': { apiKey: 'test-key' },
      },
      modelPresets: {
        'asset-deepseek-r1': { provider: 'asset-deepseek', model: 'deepseek-r1' },
      },
      model_presets: {
        speech: { provider: 'stepfun', model: 'stepaudio-2.5-asr' },
      },
      modelDefaults: { text: 'asset-deepseek-r1' },
      model_defaults: { speechToText: 'speech' },
      agents: { defaults: { model: 'deepseek-r1', provider: 'asset-deepseek' } },
    }, service);

    expect(patch.model_presets).toHaveProperty('asset-deepseek-r1');
    expect(patch.modelPresets).toBeUndefined();
    expect(patch.model_defaults).toEqual({ text: 'asset-deepseek-r1' });
    expect(patch.modelDefaults).toBeUndefined();
  });

  it('rejects an incomplete deployment model service', () => {
    expect(() => buildDesktopDefaultModelConfig({
      providerId: 'asset-deepseek',
      providerLabel: '资产DeepSeek',
      apiKey: '',
      apiBase: 'http://model.test/v1',
      apiType: 'auto',
      model: 'deepseek-r1',
      presetId: 'asset-deepseek-r1',
    })).toThrow('Default desktop model service is missing apiKey');
  });
});

describe('desktop default voice cleanup', () => {
  const generatedPreset = {
    label: 'stepfun / stepaudio-2.5-asr',
    provider: 'stepfun',
    model: 'stepaudio-2.5-asr',
    capabilities: ['speech_to_text'],
  };

  it('disables voice for a profile that has no explicitly configured voice provider', () => {
    expect(buildDesktopVoiceCleanupPatch({})).toEqual({
      transcription: {
        enabled: false,
        provider: null,
        model: null,
        language: null,
      },
    });
  });

  it('removes the uncredentialed StepFun voice default created by older GUI builds', () => {
    const patch = buildDesktopVoiceCleanupPatch({
      transcription: {
        enabled: true,
        provider: 'stepfun',
        model: 'stepaudio-2.5-asr',
        language: 'zh',
      },
      providers: { stepfun: { apiKey: null } },
      model_presets: {
        'stepfun-stepaudio-2-5-asr-speech_to_text': generatedPreset,
      },
      model_defaults: {
        text: 'default',
        speechToText: 'stepfun-stepaudio-2-5-asr-speech_to_text',
      },
    });

    expect(patch).toEqual({
      transcription: {
        enabled: false,
        provider: null,
        model: null,
        language: null,
      },
      model_presets: {
        'stepfun-stepaudio-2-5-asr-speech_to_text': undefined,
      },
      model_defaults: {
        speechToText: null,
      },
    });
  });

  it('preserves an explicitly credentialed StepFun voice service', () => {
    expect(buildDesktopVoiceCleanupPatch({
      transcription: {
        enabled: true,
        provider: 'stepfun',
        model: 'stepaudio-2.5-asr',
      },
      providers: { stepfun: { apiKey: 'voice-key' } },
      model_presets: {
        'stepfun-stepaudio-2-5-asr-speech_to_text': generatedPreset,
      },
      model_defaults: {
        speechToText: 'stepfun-stepaudio-2-5-asr-speech_to_text',
      },
    })).toEqual({});
  });

  it('preserves a different user-configured voice provider', () => {
    expect(buildDesktopVoiceCleanupPatch({
      transcription: {
        enabled: true,
        provider: 'openai',
        model: 'whisper-1',
      },
      model_presets: {
        whisper: {
          provider: 'openai',
          model: 'whisper-1',
          capabilities: ['speech_to_text'],
        },
      },
      model_defaults: { speechToText: 'whisper' },
    })).toEqual({});
  });
});
