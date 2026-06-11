/**
 * nanobotConfig.ts
 * Syncs the GUI's settingsStore to nanobot's config.json before launching
 * the Python process. GUI is the single source of truth; nanobot is consumer.
 *
 * Config format follows nanobot's Config schema (schema.py):
 *   providers.custom.apiKey / apiBase   (camelCase — matches nanobot's to_camel serializer)
 *   agents.defaults.model / provider
 *   tools.mcpServers
 */

import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';

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

export interface MCPServerEntry {
  type?: 'stdio' | 'sse' | 'streamableHttp';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface NanobotConfigInput {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider?: GuiProvider;
  apiFormat?: 'anthropic' | 'openai-compatible';
  mcpServers?: Record<string, MCPServerEntry>;
  
  // Advanced LLM parameters
  temperature?: number;
  enableThinking?: boolean;
  thinkingBudget?: number;
  
  // Web search settings
  useBuiltinWebSearch?: boolean;
  webSearchProvider?: string;
  webSearchApiKey?: string;
  webSearchBaseUrl?: string;
  
  // Sandbox & Network safety
  sandboxEnabled?: boolean;
  networkIsolationEnabled?: boolean;
  networkWhitelist?: string[];
  allowPrivateNetworks?: boolean;
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
 * nanobot serializes its config using camelCase keys (via pydantic to_camel),
 * so we write camelCase here to avoid format-mismatch false positives that
 * would cause spurious restarts every time App.tsx syncs settings.
 */
export async function syncNanobotConfig(cfg: NanobotConfigInput): Promise<boolean> {
  const workspaceDir = path.join(app.getPath('userData'), 'nanobot-workspace');
  const nanobotDir = path.join(workspaceDir, '.nanobot');
  await fs.mkdir(nanobotDir, { recursive: true });

  const configPath = path.join(nanobotDir, 'config.json');
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

  // ── Resolve actual apiKey (never write the '********' placeholder) ──────
  // When syncGatewaySettingsToStore() reads the key back from nanobot, it
  // sets apiKey = '********' to avoid logging the real secret.
  // We must preserve the real key from existing config in that case.
  let resolvedApiKey = cfg.apiKey;
  if (resolvedApiKey === '********') {
    // nanobot stores in camelCase; fall back to snake_case for older configs.
    const existingKey =
      existing?.providers?.[providerName]?.apiKey ??
      existing?.providers?.[providerName]?.api_key;
    if (existingKey && existingKey !== '********') {
      resolvedApiKey = existingKey;
    } else {
      // We don't have the real key yet — skip writing to avoid a restart loop.
      console.log('[nanobotConfig] Skipping sync: apiKey is placeholder and no existing key found');
      return false;
    }
  }

  // ── Build only the fields we own (camelCase to match nanobot's serializer) ──
  const patch: Record<string, any> = {
    agents: {
      defaults: {
        model: cfg.model,
        provider: providerName,
        temperature: cfg.temperature ?? 0.7,
        reasoningEffort: cfg.enableThinking ? 'medium' : 'none',
      },
    },
    providers: {
      [providerName]: {
        apiKey: resolvedApiKey,
        apiBase: apiBase ?? null,
      },
    },
    tools: {
      restrictToWorkspace: cfg.sandboxEnabled ?? true,
      webuiAllowLocalServiceAccess: cfg.allowPrivateNetworks ?? true,
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

  // Inject MCP servers if provided
  if (cfg.mcpServers && Object.keys(cfg.mcpServers).length > 0) {
    const filteredMcp: Record<string, MCPServerEntry> = {};
    for (const [name, srv] of Object.entries(cfg.mcpServers)) {
      // Skip disabled servers
      if (srv.enabled === false) continue;
      const { enabled: _drop, ...rest } = srv;
      filteredMcp[name] = rest;
    }
    patch.tools.mcpServers = filteredMcp;
  }

  // Check if there are any logical changes between existing config and our new patch
  const hasChanges = hasLogicalChanges(existing, patch);
  if (!hasChanges) {
    console.log('[nanobotConfig] Config logically unchanged at', configPath);
    return false;
  }

  // Deep-merge patch into existing config (existing fields not in patch are preserved)
  const merged = deepMerge(existing, patch);
  const nextContent = JSON.stringify(merged, null, 2);

  await fs.writeFile(configPath, nextContent, 'utf-8');
  console.log('[nanobotConfig] Synced config to', configPath);
  return true;
}
