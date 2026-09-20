/**
 * nanobotConfig.ts
 * Syncs the GUI's settingsStore to nanobot's config.json before launching
 * the Python process. GUI is the single source of truth; nanobot is consumer.
 *
 * Config format follows nanobot's Config schema (schema.py):
 *   providers.custom.apiKey / apiBase   (nested fields use camelCase)
 *   model_presets / model_defaults      (root schema fields remain snake_case)
 *   agents.defaults.model / provider
 */

import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';
import {
  DEFAULT_DESKTOP_MODEL_SERVICE,
  discoverDesktopDefaultModels,
  normalizeDesktopModelCatalog,
  type DesktopDefaultModelServiceConfig,
} from '../src/config/defaultModelService';
import { DEFAULT_WORKSPACE_DIRECTORY_NAME } from '../src/config/appDirectories';
import { LEGACY_ASSET_DEEPSEEK_MODEL_PRESET_ID } from '../src/config/builtinModelServices';
import {
  desktopMcpConfigCredentialReferences,
  getDesktopMcpCredentials,
  hasCompleteDesktopMcpCredentials,
  type DesktopMcpCredentials,
} from './builtinMcpCredentials';

const PLAYWRIGHT_MCP_PACKAGE = '@playwright/mcp@0.0.78';
const JUYUAN_MCP_URL = 'https://api.gildata.com/mcp-servers/aidata-assistant-srv-api';
const CAIHUI_MCP_URL = 'https://mcp.finchina.com/finchina-data-mcp-server/mcp';
const ANYSEARCH_MCP_URL = 'https://api.anysearch.com/mcp';
const IFIND_MCP_BASE_URL = 'https://api-mcp.51ifind.com:8643/ds-mcp-servers';
const IFIND_MCP_NAMES = [
  'hexin-ifind-ds-stock-mcp',
  'hexin-ifind-ds-fund-mcp',
  'hexin-ifind-ds-edb-mcp',
  'hexin-ifind-ds-news-mcp',
  'hexin-ifind-ds-bond-mcp',
  'hexin-ifind-ds-global-stock-mcp',
  'hexin-ifind-ds-index-mcp',
] as const;
const DESKTOP_MCP_DEFAULTS_STATE_VERSION = 1;
const DESKTOP_MCP_DEFAULTS_STATE_FILE = 'desktop-mcp-defaults.json';
let desktopModelCatalogRefresh: Promise<string[] | null> | null = null;

function refreshDesktopModelCatalog(): Promise<string[] | null> {
  if (!desktopModelCatalogRefresh) {
    desktopModelCatalogRefresh = discoverDesktopDefaultModels().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[nanobotConfig] Built-in model catalog refresh failed; using cached/fallback models: ${message}`);
      return null;
    });
  }
  return desktopModelCatalogRefresh;
}

function encodeMcpUrlCredential(value: string): string {
  // nanobot resolves ${ENV_VAR} after loading config.json. Encoding the `$`
  // and braces here would prevent that resolver from ever seeing the token.
  return /^\$\{[A-Z0-9_]+\}$/.test(value) ? value : encodeURIComponent(value);
}

// Older GUI builds silently installed this ASR model even though the desktop
// deployment only provisions a text provider. Keep the signature narrowly
// scoped so a voice service explicitly configured by the user is preserved.
const LEGACY_DESKTOP_ASR_PRESET = 'stepfun-stepaudio-2-5-asr-speech_to_text';
const LEGACY_DESKTOP_ASR_PROVIDER = 'stepfun';
const LEGACY_DESKTOP_ASR_MODEL = 'stepaudio-2.5-asr';

export type { DesktopMcpCredentials } from './builtinMcpCredentials';

function remoteMcpServer(
  url: string,
  headers: Record<string, string>,
  connectTimeout: number,
  toolTimeout: number,
) {
  const configured = Object.values(headers).some(Boolean);
  return {
    type: 'streamableHttp',
    // Keep credential-free presets installed in the toolbox without making
    // nanobot connect to unauthenticated endpoints during startup.
    url: configured ? url : '',
    headers: configured ? headers : {},
    connectTimeout,
    toolTimeout,
    enabledTools: ['*'],
  };
}

export function buildDesktopDefaultMcpServers(
  nanobotDir: string,
  credentials: DesktopMcpCredentials = getDesktopMcpCredentials(),
) {
  // Persist environment references instead of deployment secrets. The main
  // process injects the real values into nanobot; a user-supplied literal key
  // in config.json naturally overrides the bundled reference.
  const configCredentials = desktopMcpConfigCredentialReferences(credentials);
  const juyuanToken = configCredentials.juyuanToken;
  const caihuiApiKey = configCredentials.caihuiApiKey;
  const ifindApiKey = configCredentials.ifindApiKey;
  const anysearchApiKey = configCredentials.anysearchApiKey;
  const anysearchAuthorization = anysearchApiKey
    ? (/^Bearer\s+/i.test(anysearchApiKey) ? anysearchApiKey : `Bearer ${anysearchApiKey}`)
    : '';
  const ifindServers = Object.fromEntries(IFIND_MCP_NAMES.map((name) => [
    name,
    remoteMcpServer(
      `${IFIND_MCP_BASE_URL}/${name}`,
      { Authorization: ifindApiKey },
      15,
      30,
    ),
  ]));

  return {
    juyuan: {
      type: 'streamableHttp',
      url: juyuanToken
        ? `${JUYUAN_MCP_URL}?token=${encodeMcpUrlCredential(juyuanToken)}`
        : '',
      connectTimeout: 10,
      toolTimeout: 60,
      enabledTools: ['*'],
    },
    caihui_mcp: remoteMcpServer(
      CAIHUI_MCP_URL,
      { 'x-api-key': caihuiApiKey },
      15,
      30,
    ),
    ...ifindServers,
    anysearch: remoteMcpServer(
      ANYSEARCH_MCP_URL,
      { Authorization: anysearchAuthorization },
      15,
      30,
    ),
    playwright: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', PLAYWRIGHT_MCP_PACKAGE],
      cwd: path.join(nanobotDir, 'mcp', 'playwright'),
      connectTimeout: 15,
      toolTimeout: 60,
      enabledTools: ['*'],
    },
  };
}

function isCredentialFreeMcpPlaceholder(server: unknown): boolean {
  if (!server || typeof server !== 'object') return false;
  const value = server as Record<string, unknown>;
  const emptyRecord = (candidate: unknown) => (
    !candidate
    || (typeof candidate === 'object' && !Array.isArray(candidate) && Object.keys(candidate).length === 0)
  );
  const emptyList = (candidate: unknown) => !candidate || (Array.isArray(candidate) && candidate.length === 0);
  return !String(value.url ?? '').trim()
    && !String(value.command ?? '').trim()
    && emptyRecord(value.headers)
    && emptyRecord(value.env)
    && emptyList(value.args);
}

function isBundledCredentialReferenceMcpServer(server: unknown): boolean {
  if (!server || typeof server !== 'object') return false;
  const value = server as Record<string, unknown>;
  const serializedConnection = JSON.stringify({
    url: value.url ?? '',
    headers: value.headers ?? {},
    env: value.env ?? {},
    args: value.args ?? [],
  });
  return [
    '${JUYUAN_MCP_TOKEN}',
    '${CAIHUI_MCP_API_KEY}',
    '${IFIND_MCP_API_KEY}',
    '${ANYSEARCH_API_KEY}',
  ].some((reference) => serializedConnection.includes(reference));
}

export function buildDesktopManagedMcpServerPatch(
  existingServers: Record<string, unknown>,
  nanobotDir: string,
  credentials: DesktopMcpCredentials,
  { installMissing }: { installMissing: boolean },
): Record<string, unknown> {
  const defaults = buildDesktopDefaultMcpServers(nanobotDir, credentials);
  const patch: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(defaults)) {
    const existing = existingServers[name];
    const serverUrl = 'url' in server ? server.url : '';
    if (existing === undefined) {
      if (installMissing) patch[name] = server;
      continue;
    }
    if (
      name !== 'playwright'
      && typeof serverUrl === 'string'
      && serverUrl.trim()
      && isBundledCredentialReferenceMcpServer(existing)
    ) {
      // Endpoint/timeout corrections in later releases should update only
      // connectors still using our shared default. Literal user keys and
      // custom endpoints remain untouched.
      patch[name] = server;
      continue;
    }
    if (
      name !== 'playwright'
      && isCredentialFreeMcpPlaceholder(existing)
      && typeof serverUrl === 'string'
      && serverUrl.trim()
    ) {
      patch[name] = server;
    }
  }
  return patch;
}

interface DesktopMcpDefaultsState {
  version: number;
  credentialsProvisioned: boolean;
}

async function readDesktopMcpDefaultsState(pathname: string): Promise<DesktopMcpDefaultsState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(pathname, 'utf-8')) as Partial<DesktopMcpDefaultsState>;
    if (parsed.version !== DESKTOP_MCP_DEFAULTS_STATE_VERSION) return null;
    return {
      version: DESKTOP_MCP_DEFAULTS_STATE_VERSION,
      credentialsProvisioned: parsed.credentialsProvisioned === true,
    };
  } catch {
    return null;
  }
}

type GuiProvider =
  | 'volcengine'
  | 'bailian'
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'siliconflow'
  | 'qiniu'
  | 'minimax'
  | 'local'
  | 'custom';

export interface NanobotConfigInput {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider?: GuiProvider;
  apiFormat?: 'anthropic' | 'openai-compatible';
  
  // Advanced LLM parameters
  temperature?: number;
  enableThinking?: boolean;
  thinkingBudget?: number;
  
  // Web search settings
  useBuiltinWebSearch?: boolean;
  webSearchProvider?: string;
  webSearchApiKey?: string;
  webSearchBaseUrl?: string;
  
  // Workspace access & network safety
  restrictToWorkspace?: boolean;
  /** @deprecated Use restrictToWorkspace. Kept for persisted GUI compatibility. */
  sandboxEnabled?: boolean;
  networkIsolationEnabled?: boolean;
  networkWhitelist?: string[];
  webuiAllowLocalServiceAccess?: boolean;
  /** @deprecated Use webuiAllowLocalServiceAccess. */
  allowPrivateNetworks?: boolean;
}

export function buildDesktopDefaultModelConfig(
  service: DesktopDefaultModelServiceConfig = DEFAULT_DESKTOP_MODEL_SERVICE,
  models: readonly string[] = [],
) {
  const required: Array<[string, string]> = [
    ['providerId', service.providerId],
    ['providerLabel', service.providerLabel],
    ['apiKey', service.apiKey],
    ['apiBase', service.apiBase],
  ];
  const missing = required.find(([, value]) => !value.trim());
  if (missing) {
    throw new Error(`Default desktop model service is missing ${missing[0]}`);
  }
  if (!service.fallbackModels.length || service.fallbackModels.some((model) => !model.trim())) {
    throw new Error('Default desktop model service has invalid fallbackModels');
  }
  if (!service.preferredDefaultModel.trim()) {
    throw new Error('Default desktop model service is missing preferredDefaultModel');
  }

  const normalizedModels = normalizeDesktopModelCatalog(models);
  const usedPresetNames = new Set<string>();
  const modelPresets = Object.fromEntries(normalizedModels.map((model) => {
    const presetName = desktopModelPresetName(service.providerId, model, usedPresetNames);
    usedPresetNames.add(presetName);
    return [presetName, {
      label: `${service.providerLabel} / ${model}`,
      provider: service.providerId,
      model,
      capabilities: ['text'],
    }];
  }));
  const preferredPreset = Object.entries(modelPresets).find(
    ([, preset]) => preset.model === service.preferredDefaultModel,
  );
  const firstPreset = preferredPreset ?? Object.entries(modelPresets)[0];

  return {
    providers: {
      [service.providerId]: {
        label: service.providerLabel,
        apiKey: service.apiKey,
        apiBase: service.apiBase.replace(/\/+$/, ''),
        apiType: service.apiType,
      },
    },
    model_presets: modelPresets,
    ...(firstPreset
      ? {
          model_defaults: { text: firstPreset[0] },
          agents: {
            defaults: {
              modelPreset: firstPreset[0],
              model: firstPreset[1].model,
              provider: service.providerId,
            },
          },
        }
      : {}),
  };
}

function desktopModelPresetName(
  providerId: string,
  model: string,
  usedNames: ReadonlySet<string>,
): string {
  const normalized = `${providerId}-${model}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '') || `${providerId}-model`;
  const candidate = normalized.slice(0, 48).replace(/[-_]+$/g, '');
  if (!usedNames.has(candidate)) return candidate;

  let hash = 0x811c9dc5;
  for (const character of model) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  const suffix = (hash >>> 0).toString(16).padStart(8, '0');
  return `${candidate.slice(0, 39).replace(/[-_]+$/g, '')}-${suffix}`;
}

function hasProviderConnection(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const provider = value as Record<string, unknown>;
  return [
    provider.apiKey,
    provider.api_key,
    provider.apiBase,
    provider.api_base,
    provider.accessToken,
    provider.access_token,
  ].some((item) => typeof item === 'string' && item.trim().length > 0);
}

/**
 * Keep the deployment-managed provider present and reconcile its model channels
 * with the latest successfully fetched catalog. A failed refresh preserves the
 * last known list. User defaults remain untouched while their model still exists.
 */
export function buildDesktopManagedModelPatch(
  existing: Record<string, unknown>,
  service: DesktopDefaultModelServiceConfig = DEFAULT_DESKTOP_MODEL_SERVICE,
  catalogModels: readonly string[] | null = null,
) {
  const reconciledCatalogModels = catalogModels === null
    ? resolveDesktopManagedModels(existing, null, service)
    : normalizeDesktopModelCatalog(catalogModels);
  const managed = buildDesktopDefaultModelConfig(service, reconciledCatalogModels);
  const existingProviders = (existing.providers ?? {}) as Record<string, unknown>;
  const camelPresets = (existing.modelPresets ?? {}) as Record<string, unknown>;
  const snakePresets = (existing.model_presets ?? {}) as Record<string, unknown>;
  const existingPresets = { ...camelPresets, ...snakePresets };
  const camelDefaults = (existing.modelDefaults ?? {}) as Record<string, unknown>;
  const snakeDefaults = (existing.model_defaults ?? {}) as Record<string, unknown>;
  const existingDefaults = { ...camelDefaults, ...snakeDefaults };
  const existingAgents = existing.agents as {
    defaults?: { model?: unknown; provider?: unknown };
  } | undefined;
  const textDefault = existingDefaults.text;
  const hasManagedProvider = Boolean(existingProviders[service.providerId]);
  const existingManagedPresets = Object.entries(existingPresets).filter(([, value]) => (
    value
    && typeof value === 'object'
    && (value as Record<string, unknown>).provider === service.providerId
  ));
  const existingManagedPresetByModel = new Map(existingManagedPresets.flatMap(([name, value]) => {
    if (name === LEGACY_ASSET_DEEPSEEK_MODEL_PRESET_ID) return [];
    const model = (value as Record<string, unknown>).model;
    return typeof model === 'string' && model.trim() ? [[model, name] as const] : [];
  }));
  const discoveredModels = reconciledCatalogModels;
  const discoveredModelSet = new Set(discoveredModels);
  const usedPresetNames = new Set(Object.keys(existingPresets));
  const discoveredPresetByModel = new Map<string, string>();
  for (const model of discoveredModels ?? []) {
    const existingName = existingManagedPresetByModel.get(model);
    if (existingName) {
      discoveredPresetByModel.set(model, existingName);
      continue;
    }
    const name = desktopModelPresetName(service.providerId, model, usedPresetNames);
    usedPresetNames.add(name);
    discoveredPresetByModel.set(model, name);
  }
  const implicitProvider = existingAgents?.defaults?.provider;
  const implicitProviderConfig = typeof implicitProvider === 'string'
    ? existingProviders[implicitProvider] as Record<string, unknown> | undefined
    : undefined;
  const implicitProviderConfigured = hasProviderConnection(implicitProviderConfig);
  const namedDefaultPreset = typeof textDefault === 'string'
    ? existingPresets[textDefault] as Record<string, unknown> | undefined
    : undefined;
  const namedDefaultProvider = namedDefaultPreset?.provider;
  const namedDefaultConfigured = typeof namedDefaultProvider === 'string'
    && namedDefaultProvider !== 'auto'
    && hasProviderConnection(existingProviders[namedDefaultProvider]);
  const namedDefaultSurvivesCatalog = namedDefaultProvider !== service.providerId
    || (
      textDefault !== LEGACY_ASSET_DEEPSEEK_MODEL_PRESET_ID
      && typeof namedDefaultPreset?.model === 'string'
      && discoveredModelSet.has(namedDefaultPreset.model)
    );
  const implicitManagedModelSurvivesCatalog = implicitProvider !== service.providerId
    || (
      typeof existingAgents?.defaults?.model === 'string'
      && discoveredModelSet.has(existingAgents.defaults.model)
    );
  const hasUsableTextDefault = textDefault === 'default'
    ? Boolean(
        existingAgents?.defaults?.model
        && typeof implicitProvider === 'string'
        && implicitProvider !== 'auto'
        && implicitProviderConfigured
        && implicitManagedModelSurvivesCatalog
      )
    : Boolean(namedDefaultPreset && namedDefaultConfigured && namedDefaultSurvivesCatalog);
  const firstDiscoveredModel = discoveredModels.includes(service.preferredDefaultModel)
    ? service.preferredDefaultModel
    : discoveredModels[0];
  const firstDiscoveredPreset = firstDiscoveredModel
    ? discoveredPresetByModel.get(firstDiscoveredModel)
    : undefined;
  const shouldActivateManagedDefault = !hasUsableTextDefault && Boolean(firstDiscoveredPreset);
  const migratedPresets = Object.fromEntries(
    Object.entries(camelPresets).filter(([name]) => !(name in snakePresets)),
  );
  const migratedDefaults = Object.fromEntries(
    Object.entries(camelDefaults).filter(([name]) => !(name in snakeDefaults)),
  );
  const modelPresetPatch: Record<string, unknown> = { ...migratedPresets };
  for (const [name, value] of existingManagedPresets) {
    const model = (value as Record<string, unknown>).model;
    if (
      name === LEGACY_ASSET_DEEPSEEK_MODEL_PRESET_ID
      || typeof model !== 'string'
      || !discoveredModelSet.has(model)
    ) {
      modelPresetPatch[name] = undefined;
    }
  }
  for (const model of discoveredModels) {
    if (existingManagedPresetByModel.has(model)) continue;
    const presetName = discoveredPresetByModel.get(model);
    if (!presetName) continue;
    modelPresetPatch[presetName] = {
      label: `${service.providerLabel} / ${model}`,
      provider: service.providerId,
      model,
      capabilities: ['text'],
    };
  }

  return {
    providers: hasManagedProvider ? {} : managed.providers,
    model_presets: modelPresetPatch,
    // Remove legacy duplicate aliases after migrating their values. Pydantic's
    // AliasChoices prefers modelPresets when both keys exist, which otherwise
    // hides canonical model_presets entries and can make startup validation fail.
    ...('modelPresets' in existing ? { modelPresets: undefined } : {}),
    ...('modelDefaults' in existing ? { modelDefaults: undefined } : {}),
    ...(shouldActivateManagedDefault
      ? {
          model_defaults: {
            ...migratedDefaults,
            text: firstDiscoveredPreset,
          },
          agents: {
            defaults: {
              modelPreset: firstDiscoveredPreset,
              model: firstDiscoveredModel,
              provider: service.providerId,
            },
          },
        }
      : Object.keys(migratedDefaults).length > 0
        ? { model_defaults: migratedDefaults }
        : {}),
  };
}

export function resolveDesktopManagedModels(
  existing: Record<string, unknown>,
  refreshedModels: readonly string[] | null,
  service: DesktopDefaultModelServiceConfig = DEFAULT_DESKTOP_MODEL_SERVICE,
): string[] {
  if (refreshedModels !== null) {
    return normalizeDesktopModelCatalog(refreshedModels);
  }

  const cachedModels = Object.values({
    ...((existing.modelPresets ?? {}) as Record<string, unknown>),
    ...((existing.model_presets ?? {}) as Record<string, unknown>),
  }).flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const preset = value as Record<string, unknown>;
    return preset.provider === service.providerId
      && typeof preset.model === 'string'
      && preset.model.trim()
      ? [preset.model.trim()]
      : [];
  });
  return normalizeDesktopModelCatalog([...cachedModels, ...service.fallbackModels]);
}

function hasConfiguredProviderCredential(
  existing: Record<string, unknown>,
  providerName: string,
): boolean {
  const providers = (existing.providers ?? {}) as Record<string, unknown>;
  const provider = providers[providerName] as Record<string, unknown> | undefined;
  const apiKey = provider?.apiKey ?? provider?.api_key;
  return typeof apiKey === 'string' && apiKey.trim().length > 0;
}

function isLegacyDesktopAsrPreset(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const preset = value as Record<string, unknown>;
  const capabilities = Array.isArray(preset.capabilities) ? preset.capabilities : [];
  return preset.provider === LEGACY_DESKTOP_ASR_PROVIDER
    && preset.model === LEGACY_DESKTOP_ASR_MODEL
    && capabilities.length === 1
    && capabilities[0] === 'speech_to_text';
}

/**
 * Remove the voice model that older GUI builds added automatically.
 *
 * This migration only matches the exact uncredentialed StepFun preset that
 * TPCowork used to create. Any user-configured voice provider (including a
 * credentialed StepFun setup) remains untouched. Profiles without a voice
 * provider are explicitly disabled so nanobot does not synthesize a fallback
 * ASR model while loading settings.
 */
export function buildDesktopVoiceCleanupPatch(existing: Record<string, unknown>) {
  const transcription = (existing.transcription ?? {}) as Record<string, unknown>;
  const camelPresets = (existing.modelPresets ?? {}) as Record<string, unknown>;
  const snakePresets = (existing.model_presets ?? {}) as Record<string, unknown>;
  const presets = { ...camelPresets, ...snakePresets };
  const camelDefaults = (existing.modelDefaults ?? {}) as Record<string, unknown>;
  const snakeDefaults = (existing.model_defaults ?? {}) as Record<string, unknown>;
  const defaults = { ...camelDefaults, ...snakeDefaults };
  const hasStepFunCredential = hasConfiguredProviderCredential(
    existing,
    LEGACY_DESKTOP_ASR_PROVIDER,
  );
  const hasExplicitVoiceProvider = typeof transcription.provider === 'string'
    && transcription.provider.trim().length > 0;
  const isAutoTranscription = !hasStepFunCredential
    && transcription.provider === LEGACY_DESKTOP_ASR_PROVIDER
    && transcription.model === LEGACY_DESKTOP_ASR_MODEL;
  const removeAutoPreset = !hasStepFunCredential
    && isLegacyDesktopAsrPreset(presets[LEGACY_DESKTOP_ASR_PRESET]);
  const speechDefault = defaults.speechToText ?? defaults.speech_to_text;

  const patch: Record<string, unknown> = {};
  if (!hasExplicitVoiceProvider || isAutoTranscription) {
    patch.transcription = {
      enabled: false,
      provider: null,
      model: null,
      language: null,
    };
  }
  if (removeAutoPreset) {
    patch.model_presets = {
      [LEGACY_DESKTOP_ASR_PRESET]: undefined,
    };
  }
  if (!hasStepFunCredential && speechDefault === LEGACY_DESKTOP_ASR_PRESET) {
    patch.model_defaults = {
      speechToText: null,
    };
  }
  return patch;
}

function mapProvider(cfg: NanobotConfigInput): string {
  if (cfg.apiFormat === 'anthropic') {
    return cfg.provider === 'minimax' ? 'minimax_anthropic' : 'anthropic';
  }

  switch (cfg.provider) {
    case 'bailian':
      return 'dashscope';
    case 'qiniu':
    case 'local':
    case 'custom':
    case undefined:
      return 'custom';
    default:
      return cfg.provider;
  }
}

function normalizeApiBase(cfg: NanobotConfigInput): string | undefined {
  const baseUrl = cfg.baseUrl?.trim().replace(/\/+$/, '');
  if (!baseUrl) return undefined;

  if (cfg.apiFormat === 'openai-compatible' && !/\/v\d+$/i.test(baseUrl)) {
    return `${baseUrl}/v1`;
  }

  return baseUrl;
}

/** Recursively merge source into target (source wins for scalar values). */
function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

function hasLogicalChanges(existing: any, patch: any): boolean {
  if (existing === patch) return false;
  if (typeof patch !== 'object' || patch === null) {
    return existing !== patch;
  }
  if (typeof existing !== 'object' || existing === null) {
    return true;
  }
  if (Array.isArray(patch)) {
    if (!Array.isArray(existing) || existing.length !== patch.length) return true;
    for (let i = 0; i < patch.length; i++) {
      if (hasLogicalChanges(existing[i], patch[i])) return true;
    }
    return false;
  }
  for (const key of Object.keys(patch)) {
    if (hasLogicalChanges(existing[key], patch[key])) return true;
  }
  return false;
}

/**
 * Write nanobot's config.json into the workspace .nanobot/ directory.
 * Must be called BEFORE pythonBridge.start().
 *
 * Strategy: MERGE — read existing config, only patch the fields we own,
 * then write back. This preserves nanobot's internal settings (channels,
 * gateway port, api config, model_presets, etc.) that we don't manage.
 *
 * Nanobot serializes most nested config fields with camelCase aliases, while
 * the root model_presets/model_defaults fields remain snake_case.
 */
export async function syncNanobotConfig(cfg: NanobotConfigInput): Promise<boolean> {
  const workspaceDir = path.join(app.getPath('userData'), DEFAULT_WORKSPACE_DIRECTORY_NAME);
  const nanobotDir = path.join(workspaceDir, '.nanobot');
  await fs.mkdir(nanobotDir, { recursive: true });

  const configPath = path.join(nanobotDir, 'config.json');
  const mcpDefaultsStatePath = path.join(nanobotDir, DESKTOP_MCP_DEFAULTS_STATE_FILE);
  const providerName = mapProvider(cfg);
  const apiBase = normalizeApiBase(cfg);

  // Read existing config — we MERGE into it, not replace.
  let existing: Record<string, any> = {};
  let existingContent = '';
  try {
    existingContent = await fs.readFile(configPath, 'utf-8');
    existing = JSON.parse(existingContent);
  } catch {
    // First launch: config does not exist yet — start from empty object.
  }
  const firstLaunch = existingContent.length === 0;
  const mcpDefaultsState = await readDesktopMcpDefaultsState(mcpDefaultsStatePath);
  const desktopMcpCredentials = getDesktopMcpCredentials();
  const credentialsProvisioned = hasCompleteDesktopMcpCredentials(desktopMcpCredentials);
  const hasGatewayModelPresets = Object.keys({
    ...(existing.modelPresets ?? {}),
    ...(existing.model_presets ?? {}),
  }).length > 0;

  // ── Resolve actual apiKey (never write the '********' placeholder) ──────
  // When syncGatewaySettingsToStore() reads the key back from nanobot, it
  // sets apiKey = '********' to avoid logging the real secret.
  // We must preserve the real key from existing config in that case.
  let resolvedApiKey = cfg.apiKey;
  let canSyncGuiProvider = true;
  if (resolvedApiKey === '********') {
    // nanobot stores in camelCase; fall back to snake_case for older configs.
    const existingKey =
      existing?.providers?.[providerName]?.apiKey ??
      existing?.providers?.[providerName]?.api_key;
    if (existingKey && existingKey !== '********') {
      resolvedApiKey = existingKey;
    } else if (!hasGatewayModelPresets && !firstLaunch) {
      // The renderer does not have the real legacy provider key. Skip only
      // that provider patch; the managed desktop service must still be healed.
      canSyncGuiProvider = false;
    }
  }

  // ── Build only the fields we own (camelCase to match nanobot's serializer) ──
  const patch: Record<string, any> = {
    tools: {
      restrictToWorkspace: cfg.restrictToWorkspace ?? cfg.sandboxEnabled ?? false,
      webuiAllowLocalServiceAccess: cfg.webuiAllowLocalServiceAccess ?? cfg.allowPrivateNetworks ?? true,
      ssrfWhitelist: cfg.networkWhitelist ?? [],
      web: {
        enable: cfg.useBuiltinWebSearch ?? true,
        search: {
          provider: cfg.webSearchProvider ?? 'duckduckgo',
          apiKey: cfg.webSearchApiKey ?? '',
          baseUrl: cfg.webSearchBaseUrl ?? '',
        },
      },
    },
  };
  const refreshedManagedModels = await refreshDesktopModelCatalog();
  // This section is gateway-owned after initial setup. Never overwrite a
  // source or opt-out saved through the dependency settings API.
  if (!existing?.tools?.packageSources && !existing?.tools?.package_sources) {
    patch.tools.packageSources = {
      enabled: app.isPackaged === true,
      workspacePython: true,
      npmRegistry: 'http://10.94.211.66/repository/npm_mirror/',
      pypiIndexUrl: 'http://10.94.211.66/repository/officialPypi/simple/',
    };
  }
  const managedModels = resolveDesktopManagedModels(existing, refreshedManagedModels);
  const managedModelPatch = buildDesktopManagedModelPatch(
    existing,
    DEFAULT_DESKTOP_MODEL_SERVICE,
    managedModels,
  );
  const activatesManagedDefault = 'agents' in managedModelPatch;
  Object.assign(
    patch,
    deepMerge(managedModelPatch, buildDesktopVoiceCleanupPatch(existing)),
  );

  const shouldApplyDesktopMcpDefaults = firstLaunch
    || mcpDefaultsState === null
    || (!mcpDefaultsState.credentialsProvisioned && credentialsProvisioned);
  let nextMcpDefaultsState: DesktopMcpDefaultsState | null = null;
  if (shouldApplyDesktopMcpDefaults) {
    const playwrightCwd = path.join(nanobotDir, 'mcp', 'playwright');
    await fs.mkdir(playwrightCwd, { recursive: true });
    const existingMcpServers = {
      ...(existing?.tools?.mcp_servers ?? {}),
      ...(existing?.tools?.mcpServers ?? {}),
    } as Record<string, unknown>;
    const managedMcpPatch = buildDesktopManagedMcpServerPatch(
      existingMcpServers,
      nanobotDir,
      desktopMcpCredentials,
      // First adoption installs every preset. When credentials are supplied
      // later, heal placeholders without resurrecting user-removed services.
      { installMissing: firstLaunch || mcpDefaultsState === null },
    );
    if (Object.keys(managedMcpPatch).length > 0) {
      patch.tools.mcpServers = deepMerge(patch.tools.mcpServers ?? {}, managedMcpPatch);
    }
    nextMcpDefaultsState = {
      version: DESKTOP_MCP_DEFAULTS_STATE_VERSION,
      credentialsProvisioned,
    };
  }
  if (
    existing?.tools?.mcpServers?.playwright
    || existing?.tools?.mcp_servers?.playwright
  ) {
    // Heal the bundled Playwright server after the workspace directory moves.
    const playwrightCwd = path.join(nanobotDir, 'mcp', 'playwright');
    await fs.mkdir(playwrightCwd, { recursive: true });
    patch.tools.mcpServers = deepMerge(patch.tools.mcpServers ?? {}, {
      playwright: { cwd: playwrightCwd },
    });
  }
  if (
    !activatesManagedDefault &&
    !firstLaunch &&
    !hasGatewayModelPresets &&
    canSyncGuiProvider
  ) {
    patch.agents = {
      defaults: {
        model: cfg.model,
        provider: providerName,
        temperature: cfg.temperature ?? 0.7,
        reasoningEffort: cfg.enableThinking ? 'medium' : 'none',
      },
    };
    patch.providers = deepMerge(patch.providers ?? {}, {
      [providerName]: {
        apiKey: resolvedApiKey,
        apiBase: apiBase ?? null,
      },
    });
  }

  // The CLI also receives this workspace path, but persisting it keeps the
  // config and every later gateway restart aligned with the desktop default.
  patch.agents = deepMerge(patch.agents ?? {}, {
    defaults: { workspace: workspaceDir },
  });

  // Check if there are any logical changes between existing config and our new patch
  const hasChanges = hasLogicalChanges(existing, patch);
  if (!hasChanges) {
    if (nextMcpDefaultsState) {
      await fs.writeFile(mcpDefaultsStatePath, JSON.stringify(nextMcpDefaultsState, null, 2), 'utf-8');
    }
    console.log('[nanobotConfig] Config logically unchanged at', configPath);
    return false;
  }

  // Deep-merge patch into existing config (existing fields not in patch are preserved)
  const merged = deepMerge(existing, patch);
  const nextContent = JSON.stringify(merged, null, 2);

  await fs.writeFile(configPath, nextContent, 'utf-8');
  if (nextMcpDefaultsState) {
    await fs.writeFile(mcpDefaultsStatePath, JSON.stringify(nextMcpDefaultsState, null, 2), 'utf-8');
  }
  console.log('[nanobotConfig] Synced config to', configPath);
  return true;
}
