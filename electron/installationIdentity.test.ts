import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureInstallationId,
  INSTALLATION_ID_FILENAME,
  LINUX_SYSTEM_INSTALLATION_ID_PATH,
  systemInstallationMarkerPath,
} from './installationIdentity';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tpcowork-installation-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

describe('installation identity', () => {
  it('reuses the installer marker for every launch in one installation', async () => {
    const userData = await temporaryDirectory();
    await fs.writeFile(path.join(userData, INSTALLATION_ID_FILENAME), 'install-a\n');

    const first = await ensureInstallationId(userData, true);
    const second = await ensureInstallationId(userData, true);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it('creates a fallback marker for packages made by an older installer', async () => {
    const userData = await temporaryDirectory();

    const first = await ensureInstallationId(userData, true);
    const second = await ensureInstallationId(userData, true);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it('prefers the DEB system marker without replacing the user fallback', async () => {
    const root = await temporaryDirectory();
    const userData = path.join(root, 'user-data');
    const systemMarker = path.join(root, 'var', 'lib', 'tpcowork', 'installation-id');
    await fs.mkdir(userData, { recursive: true });
    await fs.mkdir(path.dirname(systemMarker), { recursive: true });
    await fs.writeFile(path.join(userData, INSTALLATION_ID_FILENAME), 'legacy-user-install\n');
    await fs.writeFile(systemMarker, 'deb-install-a\n');

    const installationId = await ensureInstallationId(userData, true, systemMarker);

    expect(installationId).not.toBe(
      await ensureInstallationId(userData, true),
    );
    expect(await fs.readFile(systemMarker, 'utf-8')).toBe('deb-install-a\n');
  });

  it('falls back to the user marker when the DEB system marker is absent', async () => {
    const root = await temporaryDirectory();
    const userData = path.join(root, 'user-data');
    const missingSystemMarker = path.join(root, 'missing', 'installation-id');

    const first = await ensureInstallationId(userData, true, missingSystemMarker);
    const second = await ensureInstallationId(userData, true, missingSystemMarker);

    expect(first).toBe(second);
    expect(await fs.readFile(path.join(userData, INSTALLATION_ID_FILENAME), 'utf-8'))
      .toMatch(/^[0-9a-f-]+\n$/);
  });

  it('uses the system marker only for installed Linux packages', () => {
    expect(systemInstallationMarkerPath('linux')).toBe(LINUX_SYSTEM_INSTALLATION_ID_PATH);
    expect(systemInstallationMarkerPath('linux', '/tmp/TPCowork.AppImage')).toBeNull();
    expect(systemInstallationMarkerPath('darwin')).toBeNull();
    expect(systemInstallationMarkerPath('win32')).toBeNull();
  });

  it('keeps development launches stable without writing an installer marker', async () => {
    const userData = await temporaryDirectory();

    await expect(ensureInstallationId(userData, false))
      .resolves.toBe('development-installation');
    await expect(fs.stat(path.join(userData, INSTALLATION_ID_FILENAME)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
