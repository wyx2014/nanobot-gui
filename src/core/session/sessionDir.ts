import { fsBridge, osBridge } from '@/lib/ipc-factory';
import { joinPath } from '../../utils/pathUtils';

let cachedBasePath: string | null = null;

/**
 * Get the session output directory for a specific conversation.
 * Creates the directory if it doesn't exist.
 *
 * Directory structure (platform-dependent):
 * macOS: ~/Library/Application Support/com.ruyi.app/sessions/{id}/outputs/
 * Windows: %APPDATA%/com.ruyi.app/sessions/{id}/outputs/
 */
export async function getSessionOutputDir(conversationId: string): Promise<string> {
  if (!cachedBasePath) {
    const appData = await osBridge.appDataDir();
    cachedBasePath = joinPath(appData, 'sessions');
  }

  const outputDir = joinPath(cachedBasePath, conversationId, 'outputs');

  if (!(await fsBridge.exists(outputDir))) {
    await fsBridge.mkdir(outputDir, { recursive: true });
  }

  return outputDir;
}
