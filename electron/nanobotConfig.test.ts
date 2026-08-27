import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/tpcowork-test'),
  },
}));

import {
  buildDesktopDefaultMcpServers,
  buildDesktopManagedMcpServerPatch,
  buildDesktopDefaultModelConfig,
  buildDesktopManagedModelPatch,
  resolveDesktopManagedModels,
  buildDesktopVoiceCleanupPatch,
} from './nanobotConfig';
import { discoverDesktopDefaultModels } from '../src/config/defaultModelService';

describe('desktop default MCP servers', () => {
  const emptyCredentials = {
    juyuanToken: '',
    caihuiApiKey: '',
    ifindApiKey: '',
    anysearchApiKey: '',
  };

  it('contains the built-in finance connectors without embedding keys', () => {
    const servers = buildDesktopDefaultMcpServers(
      '/tmp/tpcowork-test/.nanobot',
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
      cwd: path.join('/tmp/tpcowork-test/.nanobot', 'mcp', 'playwright'),
    });
  });

  it('persists deployment credentials as runtime environment references', () => {
    const servers = buildDesktopDefaultMcpServers('/tmp/tpcowork-test/.nanobot', {
      juyuanToken: 'token with spaces',
      caihuiApiKey: 'caihui-key',
      ifindApiKey: 'ifind-key',
      anysearchApiKey: 'anysearch-key',
    });

    expect(servers.juyuan.url).toBe(
      'https://api.gildata.com/mcp-servers/aidata-assistant-srv-api?token=${JUYUAN_MCP_TOKEN}',
    );
    expect(servers.caihui_mcp).toMatchObject({
      url: 'https://mcp.finchina.com/finchina-data-mcp-server/mcp',
      headers: { 'x-api-key': '${CAIHUI_MCP_API_KEY}' },
    });
    expect(servers['hexin-ifind-ds-index-mcp']).toMatchObject({
      url: 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-index-mcp',
      headers: { Authorization: '${IFIND_MCP_API_KEY}' },
    });
    expect(servers.anysearch).toMatchObject({
      url: 'https://api.anysearch.com/mcp',
      headers: { Authorization: 'Bearer ${ANYSEARCH_API_KEY}' },
    });
  });

  it('heals old empty placeholders while preserving user-owned keys', () => {
    const patch = buildDesktopManagedMcpServerPatch(
      {
        juyuan: { type: 'streamableHttp', url: '', headers: {} },
        anysearch: {
          type: 'streamableHttp',
          url: 'https://user.example/mcp',
          headers: { Authorization: 'Bearer personal-key' },
        },
      },
      '/tmp/tpcowork-test/.nanobot',
      {
        juyuanToken: 'shared-token',
        caihuiApiKey: 'shared-caihui',
        ifindApiKey: 'shared-ifind',
        anysearchApiKey: 'shared-anysearch',
      },
      { installMissing: false },
    );

    expect(patch.juyuan).toMatchObject({
      url: expect.stringContaining('${JUYUAN_MCP_TOKEN}'),
    });
    expect(patch).not.toHaveProperty('anysearch');
    expect(patch).not.toHaveProperty('caihui_mcp');
  });

  it('refreshes bundled references but does not replace them when a build has no key', () => {
    const existing = {
      caihui_mcp: {
        type: 'streamableHttp',
        url: 'https://old.example/mcp',
        headers: { 'x-api-key': '${CAIHUI_MCP_API_KEY}' },
      },
    };
    const configured = buildDesktopManagedMcpServerPatch(
      existing,
      '/tmp/tpcowork-test/.nanobot',
      {
        juyuanToken: '',
        caihuiApiKey: 'shared-caihui',
        ifindApiKey: '',
        anysearchApiKey: '',
      },
      { installMissing: false },
    );
    const unconfigured = buildDesktopManagedMcpServerPatch(
      existing,
      '/tmp/tpcowork-test/.nanobot',
      emptyCredentials,
      { installMissing: false },
    );

    expect(configured.caihui_mcp).toMatchObject({
      url: 'https://mcp.finchina.com/finchina-data-mcp-server/mcp',
      headers: { 'x-api-key': '${CAIHUI_MCP_API_KEY}' },
    });
    expect(unconfigured).toEqual({});
  });

  it('installs missing built-ins only during first adoption', () => {
    const credentials = {
      juyuanToken: 'shared-token',
      caihuiApiKey: 'shared-caihui',
      ifindApiKey: 'shared-ifind',
      anysearchApiKey: 'shared-anysearch',
    };

    expect(buildDesktopManagedMcpServerPatch(
      {},
      '/tmp/tpcowork-test/.nanobot',
      credentials,
      { installMissing: false },
    )).toEqual({});
    expect(buildDesktopManagedMcpServerPatch(
      {},
      '/tmp/tpcowork-test/.nanobot',
      credentials,
      { installMissing: true },
    )).toHaveProperty('caihui_mcp');
  });
});

describe('desktop default model service', () => {
  const service = {
    providerId: 'asset-deepseek',
    providerLabel: '资产DeepSeek',
    apiKey: 'test-key',
    apiBase: 'http://model.test/v1/',
    apiType: 'auto' as const,
    fallbackModels: ['deepseek-r1', 'deepseek_v4_flash'],
    preferredDefaultModel: 'deepseek_v4_flash',
  };
  const fallbackModels = [...service.fallbackModels];

  it('creates model channels from the discovered catalog and prefers v4 flash', () => {
    const config = buildDesktopDefaultModelConfig(service, fallbackModels);

    expect(config.providers['asset-deepseek']).toEqual({
      label: '资产DeepSeek',
      apiKey: 'test-key',
      apiBase: 'http://model.test/v1',
      apiType: 'auto',
    });
    expect(config.model_presets['asset-deepseek-deepseek-r1']).toMatchObject({
      provider: 'asset-deepseek',
      model: 'deepseek-r1',
      capabilities: ['text'],
    });
    expect(config.model_presets['asset-deepseek-deepseek_v4_flash']).toMatchObject({
      provider: 'asset-deepseek',
      model: 'deepseek_v4_flash',
    });
    expect(config.model_defaults.text).toBe('asset-deepseek-deepseek_v4_flash');
    expect(config.agents.defaults).toMatchObject({
      modelPreset: 'asset-deepseek-deepseek_v4_flash',
      model: 'deepseek_v4_flash',
      provider: 'asset-deepseek',
    });
  });

  it('fetches and deduplicates the current catalog with the managed credential', async () => {
    const fetchCatalog = vi.fn(async (input: string, init: {
      headers: Record<string, string>;
      signal: AbortSignal;
    }) => {
      expect(input).toBe('http://model.test/v1/models');
      expect(init.headers.Authorization).toBe('Bearer test-key');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'deepseek-r1' },
            { id: 'deepseek_v4_flash' },
            { id: 'deepseek_v4_flash' },
          ],
        }),
      };
    });

    await expect(discoverDesktopDefaultModels(service, fetchCatalog)).resolves.toEqual(fallbackModels);
  });

  it('installs the external-network fallback catalog for an empty profile', () => {
    const patch = buildDesktopManagedModelPatch({}, service, fallbackModels);

    expect(patch.providers['asset-deepseek']).toMatchObject({
      label: '资产DeepSeek',
      apiKey: 'test-key',
      apiBase: 'http://model.test/v1',
    });
    expect(patch.model_presets['asset-deepseek-deepseek-r1']).toMatchObject({
      provider: 'asset-deepseek',
      model: 'deepseek-r1',
    });
    expect(patch.model_presets['asset-deepseek-deepseek_v4_flash']).toMatchObject({
      provider: 'asset-deepseek',
      model: 'deepseek_v4_flash',
    });
    expect(patch.model_defaults?.text).toBe('asset-deepseek-deepseek_v4_flash');
    expect(patch.agents?.defaults.modelPreset).toBe('asset-deepseek-deepseek_v4_flash');
  });

  it('keeps cached models and adds fallbacks when the internal catalog is unreachable', () => {
    const models = resolveDesktopManagedModels({
      model_presets: {
        cached: { provider: 'asset-deepseek', model: 'deepseek-v5-preview' },
        unrelated: { provider: 'custom', model: 'custom-model' },
      },
    }, null, service);

    expect(models).toEqual([
      'deepseek-v5-preview',
      'deepseek-r1',
      'deepseek_v4_flash',
    ]);
  });

  it('adds the managed service without replacing an existing valid default', () => {
    const patch = buildDesktopManagedModelPatch({
      providers: { custom: { apiKey: 'old-key' } },
      modelPresets: {
        existing: { provider: 'custom', model: 'old-model' },
      },
      modelDefaults: { text: 'existing' },
      agents: { defaults: { model: 'old-model', provider: 'custom' } },
    }, service, fallbackModels);

    expect(patch.providers).toHaveProperty('asset-deepseek');
    expect(patch.model_presets).toHaveProperty('asset-deepseek-deepseek-r1');
    expect(patch.model_presets).toHaveProperty('asset-deepseek-deepseek_v4_flash');
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
    }, service, fallbackModels);

    expect(patch.model_defaults?.text).toBe('asset-deepseek-deepseek_v4_flash');
    expect(patch.agents?.defaults).toMatchObject({
      modelPreset: 'asset-deepseek-deepseek_v4_flash',
      model: 'deepseek_v4_flash',
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
    }, service, fallbackModels);

    expect(patch.providers).toEqual({});
    expect(patch.model_presets['asset-deepseek-r1']).toBeUndefined();
    expect(patch.model_presets).toHaveProperty('preferred');
    expect(patch.model_presets).toHaveProperty('asset-deepseek-deepseek-r1');
    expect(patch.model_presets).toHaveProperty('asset-deepseek-deepseek_v4_flash');
    expect(patch.model_defaults).toEqual({ text: 'preferred' });
    expect(patch).not.toHaveProperty('agents');
  });

  it('migrates the old system-selected R1 default to the preferred v4 flash model', () => {
    const patch = buildDesktopManagedModelPatch({
      providers: {
        'asset-deepseek': { apiKey: 'test-key', apiBase: 'http://model.test/v1' },
      },
      model_presets: {
        'asset-deepseek-r1': { provider: 'asset-deepseek', model: 'deepseek-r1' },
      },
      model_defaults: { text: 'asset-deepseek-r1' },
      agents: { defaults: { model: 'deepseek-r1', provider: 'asset-deepseek' } },
    }, service, fallbackModels);

    expect(patch.model_presets['asset-deepseek-r1']).toBeUndefined();
    expect(patch.model_presets).toHaveProperty('asset-deepseek-deepseek-r1');
    expect(patch.model_defaults?.text).toBe('asset-deepseek-deepseek_v4_flash');
    expect(patch.agents?.defaults.model).toBe('deepseek_v4_flash');
  });

  it('keeps a current dynamic catalog unchanged across startup refreshes', () => {
    const patch = buildDesktopManagedModelPatch({
      providers: {
        'asset-deepseek': { apiKey: 'test-key', apiBase: 'http://model.test/v1' },
      },
      model_presets: {
        'asset-deepseek-chat': { provider: 'asset-deepseek', model: 'deepseek-chat' },
        'asset-deepseek-reasoner': { provider: 'asset-deepseek', model: 'deepseek-reasoner' },
      },
      model_defaults: { text: 'asset-deepseek-chat' },
      agents: { defaults: { model: 'deepseek-chat', provider: 'asset-deepseek' } },
    }, service, ['deepseek-chat', 'deepseek-reasoner']);

    expect(patch.model_presets).toEqual({});
    expect(patch.model_defaults).not.toBeDefined();
    expect(patch).not.toHaveProperty('agents');
  });

  it('removes retired models and moves a retired managed default to v4 flash', () => {
    const patch = buildDesktopManagedModelPatch({
      providers: {
        'asset-deepseek': { apiKey: 'test-key', apiBase: 'http://model.test/v1' },
      },
      model_presets: {
        current: { provider: 'asset-deepseek', model: 'deepseek-r1' },
        retired: { provider: 'asset-deepseek', model: 'deepseek-v3-retired' },
      },
      model_defaults: { text: 'retired' },
      agents: { defaults: { model: 'deepseek-v3-retired', provider: 'asset-deepseek' } },
    }, service, ['deepseek-r1', 'deepseek_v4_flash', 'deepseek-v5']);

    expect(patch.model_presets.retired).toBeUndefined();
    expect(patch.model_presets).toHaveProperty('asset-deepseek-deepseek_v4_flash');
    expect(patch.model_presets).toHaveProperty('asset-deepseek-deepseek-v5');
    expect(patch.model_defaults?.text).toBe('asset-deepseek-deepseek_v4_flash');
    expect(patch.agents?.defaults.model).toBe('deepseek_v4_flash');
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
    }, service, null);

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
      fallbackModels,
      preferredDefaultModel: 'deepseek_v4_flash',
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
