import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const INSTALLATION_ID_FILENAME = '.installation-id';

function normalizeInstallationId(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 512 ? normalized : null;
}

function opaqueInstallationId(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Return the ID for this concrete installation while keeping the user's
 * settings in userData. The NSIS installer creates the marker and removes it
 * only for a real uninstall; this fallback also supports older installers.
 */
export async function ensureInstallationId(
  userDataPath: string,
  packaged: boolean,
): Promise<string> {
  if (!packaged) return 'development-installation';

  const markerPath = path.join(userDataPath, INSTALLATION_ID_FILENAME);
  try {
    const existing = normalizeInstallationId(await fs.readFile(markerPath, 'utf-8'));
    if (existing) return opaqueInstallationId(existing);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const created = randomUUID();
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(markerPath, `${created}\n`, 'utf-8');
  return opaqueInstallationId(created);
}
