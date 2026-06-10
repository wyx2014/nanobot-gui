/**
 * Platform Detection Singleton
 * Provides synchronous platform checks after async initialization.
 */

import { osBridge } from '@/lib/ipc-factory';

let cached: string | null = null;

/** Initialize platform detection (call once at app startup) */
export async function initPlatform(): Promise<string> {
  cached = await osBridge.platform();
  return cached;
}

/** Returns true if running on Windows */
export function isWindows(): boolean {
  return cached === 'windows';
}

/** Returns true if running on macOS */
export function isMacOS(): boolean {
  return cached === 'macos';
}

/** Get the cached platform string. Warns if called before initPlatform(). */
export function getPlatform(): string {
  if (cached === null) {
    console.warn('[platform] getPlatform() called before initPlatform() — defaulting to "unknown"');
  }
  return cached ?? 'unknown';
}
