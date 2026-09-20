// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_DIRECTORY_NAME } from '../src/config/appDirectories';

const environment = vi.hoisted(() => ({ directory: '', packaged: false }));
vi.mock('electron', () => ({ app: { getPath: () => environment.directory, get isPackaged() { return environment.packaged; } } }));
vi.mock('../src/config/defaultModelService', async (original) => ({
  ...await original<typeof import('../src/config/defaultModelService')>(),
  discoverDesktopDefaultModels: vi.fn().mockResolvedValue([]),
}));
import { syncNanobotConfig } from './nanobotConfig';
let configPath: string;
beforeEach(async () => {
  environment.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tpcowork-dependency-config-'));
  environment.packaged = false;
  configPath = path.join(environment.directory, DEFAULT_WORKSPACE_DIRECTORY_NAME, '.nanobot', 'config.json');
});
afterEach(async () => { await fs.rm(environment.directory, { recursive: true, force: true }); });
const input = { apiKey: '', baseUrl: '', model: '' };

describe('desktop dependency configuration', () => {
  it.each([true, false])('initializes package sources for packaged=%s', async (packaged) => {
    environment.packaged = packaged;
    await syncNanobotConfig(input);
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    expect(config.tools.packageSources).toEqual({
      enabled: packaged, workspacePython: true,
      npmRegistry: 'http://10.94.211.66/repository/npm_mirror/',
      pypiIndexUrl: 'http://10.94.211.66/repository/officialPypi/simple/',
    });
  });

  it.each(['packageSources', 'package_sources'])('preserves gateway-owned %s settings across startup sync', async (key) => {
    environment.packaged = true;
    const saved = { enabled: false, npmRegistry: 'https://npm.example/', pypiIndexUrl: 'https://pip.example/simple/', workspacePython: false };
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ tools: { [key]: saved } }));
    await syncNanobotConfig(input);
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    expect(config.tools[key]).toEqual(saved);
    if (key === 'package_sources') expect(config.tools.packageSources).toBeUndefined();
  });
});
