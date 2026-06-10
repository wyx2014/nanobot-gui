import { fsBridge, osBridge } from '@/lib/ipc-factory';
import { joinPath, getParentDir } from '@/utils/pathUtils';

/**
 * Save a skill or agent .md file to ~/.ruyi/{folder}/{name}/{fileName}.
 * If `oldFilePath` is provided and the name changed, removes the old directory.
 */
export async function saveItemToAbuDir(
  folder: 'skills' | 'agents' | 'experts',
  fileName: 'SKILL.md' | 'AGENT.md' | 'EXPERT.md',
  name: string,
  mdContent: string,
  oldFilePath?: string,
): Promise<void> {
  const home = await osBridge.homeDir();
  const targetDir = joinPath(home, '.ruyi', folder, name);
  await fsBridge.mkdir(targetDir, { recursive: true });
  await fsBridge.writeTextFile(joinPath(targetDir, fileName), mdContent);

  // If renamed, remove old directory
  if (oldFilePath) {
    const oldDir = getParentDir(oldFilePath);
    if (oldDir !== targetDir) {
      await fsBridge.remove(oldDir, { recursive: true }).catch(() => {/* ignore if already gone */});
    }
  }
}
