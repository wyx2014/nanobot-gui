/**
 * Deployment-managed credentials for the finance/search MCP presets.
 *
 * The four compile-time constants are defined only for the Electron main
 * bundle in electron.vite.config.ts. They must never be defined for the
 * renderer or exposed through preload IPC.
 *
 * A runtime environment variable wins in development/CI. Packaged builds use
 * the compiled value and pass it only to the child nanobot process. User keys
 * saved in config.json are literal values and therefore override these
 * environment-backed defaults.
 */

declare const __TPACOWORK_BUILTIN_JUYUAN_MCP_TOKEN__: string | undefined;
declare const __TPACOWORK_BUILTIN_CAIHUI_MCP_API_KEY__: string | undefined;
declare const __TPACOWORK_BUILTIN_IFIND_MCP_API_KEY__: string | undefined;
declare const __TPACOWORK_BUILTIN_ANYSEARCH_API_KEY__: string | undefined;

export const DESKTOP_MCP_CREDENTIAL_ENV = Object.freeze({
  juyuanToken: 'JUYUAN_MCP_TOKEN',
  caihuiApiKey: 'CAIHUI_MCP_API_KEY',
  ifindApiKey: 'IFIND_MCP_API_KEY',
  anysearchApiKey: 'ANYSEARCH_API_KEY',
} as const);

export interface DesktopMcpCredentials {
  juyuanToken: string;
  caihuiApiKey: string;
  ifindApiKey: string;
  anysearchApiKey: string;
}

function compiledCredentials(): DesktopMcpCredentials {
  return {
    juyuanToken: typeof __TPACOWORK_BUILTIN_JUYUAN_MCP_TOKEN__ === 'string'
      ? __TPACOWORK_BUILTIN_JUYUAN_MCP_TOKEN__.trim()
      : '',
    caihuiApiKey: typeof __TPACOWORK_BUILTIN_CAIHUI_MCP_API_KEY__ === 'string'
      ? __TPACOWORK_BUILTIN_CAIHUI_MCP_API_KEY__.trim()
      : '',
    ifindApiKey: typeof __TPACOWORK_BUILTIN_IFIND_MCP_API_KEY__ === 'string'
      ? __TPACOWORK_BUILTIN_IFIND_MCP_API_KEY__.trim()
      : '',
    anysearchApiKey: typeof __TPACOWORK_BUILTIN_ANYSEARCH_API_KEY__ === 'string'
      ? __TPACOWORK_BUILTIN_ANYSEARCH_API_KEY__.trim()
      : '',
  };
}

export function getDesktopMcpCredentials(
  env: NodeJS.ProcessEnv = process.env,
): DesktopMcpCredentials {
  const bundled = compiledCredentials();
  return {
    juyuanToken: env[DESKTOP_MCP_CREDENTIAL_ENV.juyuanToken]?.trim() || bundled.juyuanToken,
    caihuiApiKey: env[DESKTOP_MCP_CREDENTIAL_ENV.caihuiApiKey]?.trim() || bundled.caihuiApiKey,
    ifindApiKey: env[DESKTOP_MCP_CREDENTIAL_ENV.ifindApiKey]?.trim() || bundled.ifindApiKey,
    anysearchApiKey: env[DESKTOP_MCP_CREDENTIAL_ENV.anysearchApiKey]?.trim() || bundled.anysearchApiKey,
  };
}

/** Values persisted in config.json. No deployment secret is returned here. */
export function desktopMcpConfigCredentialReferences(
  credentials: DesktopMcpCredentials,
): DesktopMcpCredentials {
  const reference = (name: string, configured: string) => configured.trim() ? `\${${name}}` : '';
  return {
    juyuanToken: reference(DESKTOP_MCP_CREDENTIAL_ENV.juyuanToken, credentials.juyuanToken),
    caihuiApiKey: reference(DESKTOP_MCP_CREDENTIAL_ENV.caihuiApiKey, credentials.caihuiApiKey),
    ifindApiKey: reference(DESKTOP_MCP_CREDENTIAL_ENV.ifindApiKey, credentials.ifindApiKey),
    anysearchApiKey: reference(DESKTOP_MCP_CREDENTIAL_ENV.anysearchApiKey, credentials.anysearchApiKey),
  };
}

/** Environment injected into the nanobot child process. */
export function desktopMcpGatewayEnvironment(
  credentials: DesktopMcpCredentials = getDesktopMcpCredentials(),
): Record<string, string> {
  return Object.fromEntries(
    (Object.keys(DESKTOP_MCP_CREDENTIAL_ENV) as Array<keyof DesktopMcpCredentials>)
      .map((key) => [DESKTOP_MCP_CREDENTIAL_ENV[key], credentials[key].trim()] as const)
      .filter(([, value]) => Boolean(value)),
  );
}

export function hasCompleteDesktopMcpCredentials(
  credentials: DesktopMcpCredentials,
): boolean {
  return Object.values(credentials).every((value) => Boolean(value.trim()));
}
