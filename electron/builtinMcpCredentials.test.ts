import { describe, expect, it } from 'vitest';

import {
  desktopMcpConfigCredentialReferences,
  desktopMcpGatewayEnvironment,
  getDesktopMcpCredentials,
  hasCompleteDesktopMcpCredentials,
} from './builtinMcpCredentials';

describe('desktop built-in MCP credentials', () => {
  const credentials = {
    juyuanToken: 'juyuan-shared',
    caihuiApiKey: 'caihui-shared',
    ifindApiKey: 'ifind-shared',
    anysearchApiKey: 'anysearch-shared',
  };

  it('loads deployment credentials from the main-process environment', () => {
    expect(getDesktopMcpCredentials({
      JUYUAN_MCP_TOKEN: ' juyuan-shared ',
      CAIHUI_MCP_API_KEY: 'caihui-shared',
      IFIND_MCP_API_KEY: 'ifind-shared',
      ANYSEARCH_API_KEY: 'anysearch-shared',
    })).toEqual(credentials);
  });

  it('persists only environment references in nanobot config', () => {
    const references = desktopMcpConfigCredentialReferences(credentials);

    expect(references).toEqual({
      juyuanToken: '${JUYUAN_MCP_TOKEN}',
      caihuiApiKey: '${CAIHUI_MCP_API_KEY}',
      ifindApiKey: '${IFIND_MCP_API_KEY}',
      anysearchApiKey: '${ANYSEARCH_API_KEY}',
    });
    expect(JSON.stringify(references)).not.toContain('shared');
  });

  it('injects configured values into nanobot without emitting empty variables', () => {
    expect(desktopMcpGatewayEnvironment({
      ...credentials,
      anysearchApiKey: '',
    })).toEqual({
      JUYUAN_MCP_TOKEN: 'juyuan-shared',
      CAIHUI_MCP_API_KEY: 'caihui-shared',
      IFIND_MCP_API_KEY: 'ifind-shared',
    });
    expect(hasCompleteDesktopMcpCredentials(credentials)).toBe(true);
    expect(hasCompleteDesktopMcpCredentials({ ...credentials, anysearchApiKey: '' })).toBe(false);
  });
});
