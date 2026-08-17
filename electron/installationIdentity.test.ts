import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureInstallationId, INSTALLATION_ID_FILENAME } from './installationIdentity';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tpacowork-installation-'));
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

  it('keeps development launches stable without writing an installer marker', async () => {
    const userData = await temporaryDirectory();

    await expect(ensureInstallationId(userData, false))
      .resolves.toBe('development-installation');
    await expect(fs.stat(path.join(userData, INSTALLATION_ID_FILENAME)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
