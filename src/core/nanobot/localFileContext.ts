import { isLocalFilePath } from '@/utils/pathUtils';

export const LEGACY_LOCAL_FILE_CONTEXT_HEADER =
  '本地文件引用（请按路径读取这些文件；如果路径超出当前工作区权限，请先说明无法访问）：';

export interface LocalFileReference {
  name: string;
  path: string;
}

export interface LocalFileContextProjection {
  visibleContent: string;
  files: LocalFileReference[];
  contextPrefix?: string;
}

const LOCAL_FILE_LINE = /^-\s+(.+?):\s+((?:\/|[A-Za-z]:[\\/]).+)$/;

/**
 * Project the old prompt-prefix transport into user-facing text and file
 * metadata. The prefix remains on the wire for nanobot compatibility, but it
 * must never look like text the user typed.
 */
export function projectLegacyLocalFileContext(content: string): LocalFileContextProjection {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== LEGACY_LOCAL_FILE_CONTEXT_HEADER) {
    return { visibleContent: content, files: [] };
  }

  const files: LocalFileReference[] = [];
  let index = 1;
  while (index < lines.length) {
    const match = LOCAL_FILE_LINE.exec(lines[index]);
    if (!match) break;
    const name = match[1].trim();
    const path = match[2].trim();
    if (!name || !isLocalFilePath(path)) break;
    files.push({ name, path });
    index += 1;
  }

  // Only hide a prefix when it contains at least one valid absolute path.
  // This avoids rewriting natural user text that happens to start similarly.
  if (files.length === 0) {
    return { visibleContent: content, files: [] };
  }

  const visibleLines = lines.slice(index);
  while (visibleLines[0]?.trim() === '') visibleLines.shift();

  return {
    visibleContent: visibleLines.join(newline),
    files,
    contextPrefix: lines.slice(0, index).join(newline),
  };
}

/** Preserve hidden file context when the visible user prompt is edited. */
export function replaceVisibleLocalFileContent(
  originalContent: string,
  nextVisibleContent: string,
): string {
  const projection = projectLegacyLocalFileContext(originalContent);
  if (!projection.contextPrefix) return nextVisibleContent;
  const newline = originalContent.includes('\r\n') ? '\r\n' : '\n';
  return nextVisibleContent
    ? `${projection.contextPrefix}${newline}${nextVisibleContent}`
    : projection.contextPrefix;
}
