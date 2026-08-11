import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/tparuyi-test'),
  },
}));

import { buildDesktopDefaultMcpServers } from './nanobotConfig';

describe('desktop default MCP servers', () => {
  const emptyCredentials = {
    juyuanToken: '',
    caihuiApiKey: '',
    ifindApiKey: '',
    anysearchApiKey: '',
  };

  it('contains the built-in finance connectors without embedding keys', () => {
    const servers = buildDesktopDefaultMcpServers(
      '/tmp/tparuyi-test/.nanobot',
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
      cwd: path.join('/tmp/tparuyi-test/.nanobot', 'mcp', 'playwright'),
    });
  });

  it('uses explicitly provisioned connector keys', () => {
    const servers = buildDesktopDefaultMcpServers('/tmp/tparuyi-test/.nanobot', {
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
