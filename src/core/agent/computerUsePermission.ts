/**
 * Computer Use permission test — check if screenshot capture works.
 *
 * On macOS, capturing the screen requires "Screen Recording" permission.
 * On Windows, it usually works without extra permissions.
 *
 * We test by attempting a small screenshot via the Rust capture_screen command.
 */

import { ipc } from '@/lib/ipc-factory';

/**
 * Test if we have permission to capture the screen.
 * Returns true if the screenshot succeeds, false if denied.
 */
export async function testScreenshotPermission(): Promise<boolean> {
  try {
    await ipc.invoke('capture_screen', {});
    return true;
  } catch {
    return false;
  }
}
