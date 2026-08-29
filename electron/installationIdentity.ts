import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const INSTALLATION_ID_FILENAME = '.installation-id';
export const LINUX_SYSTEM_INSTALLATION_ID_PATH = '/var/lib/tpcowork/installation-id';

function normalizeInstallationId(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 512 ? normalized : null;
}

function opaqueInstallationId(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readInstallationId(
  markerPath: string,
  tolerateAccessFailure = false,
): Promise<string | null> {
  try {
    return normalizeInstallationId(await fs.readFile(markerPath, 'utf-8'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || (tolerateAccessFailure && (code === 'EACCES' || code === 'EPERM'))) {
      return null;
    }
    throw error;
  }
}

export function systemInstallationMarkerPath(
  platform: string,
  appImagePath?: string,
): string | null {
  return platform === 'linux' && !appImagePath
    ? LINUX_SYSTEM_INSTALLATION_ID_PATH
    : null;
}

/**
 * Return the ID for this concrete installation while keeping the user's
 * settings in userData. NSIS and DEB own their installation-scoped markers;
 * AppImage and older packages fall back to a per-user marker.
 */
export async function ensureInstallationId(
  userDataPath: string,
  packaged: boolean,
  systemMarkerPath: string | null = null,
): Promise<string> {
  if (!packaged) return 'development-installation';

  if (systemMarkerPath) {
    const systemInstallationId = await readInstallationId(systemMarkerPath, true);
    if (systemInstallationId) return opaqueInstallationId(systemInstallationId);
  }

  const markerPath = path.join(userDataPath, INSTALLATION_ID_FILENAME);
  const existing = await readInstallationId(markerPath);
  if (existing) return opaqueInstallationId(existing);

  const created = randomUUID();
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(markerPath, `${created}\n`, 'utf-8');
  return opaqueInstallationId(created);
}
