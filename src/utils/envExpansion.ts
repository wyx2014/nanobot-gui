/**
 * Environment variable expansion for MCP server configs.
 * Supports ${VAR} and ${VAR:-default} syntax.
 */

import { ipc } from '@/lib/ipc-factory';

/**
 * Expand environment variable references in a string.
 * Supports:
 *   ${VAR}           → value of VAR, or empty string if unset
 *   ${VAR:-default}  → value of VAR, or "default" if unset/empty
 */
export function expandEnvString(input: string, envVars: Record<string, string>): string {
  return input.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const colonIdx = expr.indexOf(':-');
    if (colonIdx !== -1) {
      const varName = expr.slice(0, colonIdx);
      const defaultVal = expr.slice(colonIdx + 2);
      return envVars[varName] || defaultVal;
    }
    return envVars[expr] ?? '';
  });
}

/**
 * Collect all ${VAR} references from a config's args and env values.
 */
function collectEnvVarNames(config: {
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  command?: string;
}): string[] {
  const names = new Set<string>();
  const pattern = /\$\{([^:}]+)(?::-[^}]*)?\}/g;

  const scan = (str: string) => {
    let match;
    while ((match = pattern.exec(str)) !== null) {
      names.add(match[1]);
    }
  };

  if (config.command) scan(config.command);
  if (config.url) scan(config.url);
  if (config.args) config.args.forEach(scan);
  if (config.env) Object.values(config.env).forEach(scan);

  return Array.from(names);
}

/**
 * Load the required environment variables from the OS.
 */
// Cache resolved env vars for the process lifetime (env vars rarely change)
const envVarCache = new Map<string, string>();

export async function loadEnvVarsForConfig(config: {
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  command?: string;
}): Promise<Record<string, string>> {
  const names = collectEnvVarNames(config);
  if (names.length === 0) return {};

  // Check cache first
  const uncached = names.filter((n) => !envVarCache.has(n));
  if (uncached.length > 0) {
    try {
      const result = await ipc.invoke<Record<string, string>>('get_env_vars', { names: uncached });
      for (const [k, v] of Object.entries(result)) {
        envVarCache.set(k, v);
      }
    } catch (err) {
      console.warn('[EnvExpansion] Failed to load env vars:', err);
    }
  }

  const out: Record<string, string> = {};
  for (const name of names) {
    const val = envVarCache.get(name);
    if (val !== undefined) out[name] = val;
  }
  return out;
}

/**
 * Expand all ${VAR} references in a MCP server config.
 * Returns a new config with expanded values.
 */
export async function expandConfigEnvVars<T extends {
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  command?: string;
}>(config: T): Promise<T> {
  const envVars = await loadEnvVarsForConfig(config);
  if (Object.keys(envVars).length === 0) return config;

  const expanded = { ...config };

  if (expanded.command) {
    expanded.command = expandEnvString(expanded.command, envVars);
  }

  if (expanded.url) {
    expanded.url = expandEnvString(expanded.url, envVars);
  }

  if (expanded.args) {
    expanded.args = expanded.args.map((arg) => expandEnvString(arg, envVars));
  }

  if (expanded.env) {
    expanded.env = Object.fromEntries(
      Object.entries(expanded.env).map(([k, v]) => [k, expandEnvString(v, envVars)])
    );
  }

  return expanded;
}
