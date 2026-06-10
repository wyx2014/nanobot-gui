/**
 * Update Checker Module
 * Checks for new versions from a remote version.json endpoint.
 */

const fetch = globalThis.fetch;
import { APP_VERSION } from '@/utils/version';
import { getPlatform } from '@/utils/platform';
import { useSettingsStore } from '@/stores/settingsStore';

// TODO: Replace with actual R2/CDN URL when deployed
const UPDATE_CHECK_URL = 'https://ruyi-releases.your-domain.com/version.json';

// 24 hours in milliseconds
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  version: string;
  releaseNotes: string;
  publishedAt: string;
  downloadUrl: string;
}

interface VersionManifest {
  version: string;
  publishedAt: string;
  releaseNotes: string;
  downloads: Record<string, string>;
}

/**
 * Simple semver comparison: returns true if remote > local.
 * Compares major.minor.patch segments numerically.
 */
function isNewerVersion(remote: string, local: string): boolean {
  const r = remote.replace(/^v/, '').split('.').map(Number);
  const l = local.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

/**
 * Pick the download URL for the current platform from the manifest.
 */
function pickDownloadUrl(downloads: Record<string, string>): string | null {
  const p = getPlatform();
  if (p === 'macos') {
    // Prefer arm64 DMG, fallback to generic DMG
    return downloads['macos-arm64-dmg'] ?? downloads['macos-dmg'] ?? null;
  }
  if (p === 'windows') {
    return downloads['windows-exe'] ?? null;
  }
  return null;
}

/**
 * Check for updates. Returns UpdateInfo if a newer version is available, null otherwise.
 * Respects a 24-hour throttle for automatic checks (pass force=true to bypass).
 */
export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  const store = useSettingsStore.getState();

  // Throttle: skip if checked within the last 24 hours (unless forced)
  if (!force) {
    const elapsed = Date.now() - store.lastUpdateCheck;
    if (elapsed < CHECK_INTERVAL_MS) {
      return null;
    }
  }

  store.setUpdateChecking(true);

  try {
    const response = await fetch(UPDATE_CHECK_URL, {
      method: 'GET',
    });

    if (!response.ok) {
      console.warn(`[Update] Check failed: HTTP ${response.status}`);
      return null;
    }

    const manifest = (await response.json()) as VersionManifest;

    // Update the last check timestamp
    store.setLastUpdateCheck(Date.now());

    if (!isNewerVersion(manifest.version, APP_VERSION)) {
      store.setUpdateInfo(null);
      return null;
    }

    const downloadUrl = pickDownloadUrl(manifest.downloads) ?? '';
    const info: UpdateInfo = {
      version: manifest.version,
      releaseNotes: manifest.releaseNotes,
      publishedAt: manifest.publishedAt,
      downloadUrl,
    };

    store.setUpdateInfo(info);
    return info;
  } catch (err) {
    console.warn('[Update] Check failed:', err);
    return null;
  } finally {
    store.setUpdateChecking(false);
  }
}
