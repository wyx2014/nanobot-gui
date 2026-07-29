import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/tparuyi-test'),
  },
}));

import { buildDesktopDefaultMcpServers } from './nanobotConfig';

describe('desktop default MCP servers', () => {
  it('contains only juyuan and playwright without embedding a token', () => {
    const servers = buildDesktopDefaultMcpServers('/tmp/tparuyi-test/.nanobot', '');

    expect(Object.keys(servers)).toEqual(['juyuan', 'playwright']);
    expect(servers.juyuan).toMatchObject({
      type: 'streamableHttp',
      url: '',
      connectTimeout: 10,
    });
    expect(servers.playwright).toMatchObject({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@0.0.78'],
      cwd: path.join('/tmp/tparuyi-test/.nanobot', 'mcp', 'playwright'),
    });
  });

  it('uses an explicitly provisioned juyuan token', () => {
    const servers = buildDesktopDefaultMcpServers('/tmp/tparuyi-test/.nanobot', 'token with spaces');

    expect(servers.juyuan.url).toBe(
      'https://api.gildata.com/mcp-servers/aidata-assistant-srv-api?token=token%20with%20spaces',
    );
  });
});
