import type { WorkspaceFileEntry } from '@/lib/ipc-factory'

export type ComposerSuggestionType = 'file' | 'capability'

export interface ComposerSuggestionTrigger {
  type: ComposerSuggestionType
  query: string
  start: number
  end: number
}

export function findComposerSuggestionTrigger(
  text: string,
  cursorPosition: number,
): ComposerSuggestionTrigger | null {
  const cursor = Math.max(0, Math.min(cursorPosition, text.length))
  const beforeCursor = text.slice(0, cursor)
  const segmentStart = Math.max(
    beforeCursor.lastIndexOf(' '),
    beforeCursor.lastIndexOf('\n'),
    beforeCursor.lastIndexOf('\t'),
  ) + 1
  const segment = beforeCursor.slice(segmentStart)
  const mentionIndex = segment.lastIndexOf('@')
  const mentionPredecessor = mentionIndex > 0 ? segment[mentionIndex - 1] : ''

  // File mentions may appear after Chinese text without an extra space. An @ in
  // the active token takes priority over slashes contained in a relative path.
  // ASCII word characters before @ indicate an email address rather than a file.
  if (mentionIndex >= 0 && !/[A-Za-z0-9._%+-]/.test(mentionPredecessor)) {
    const start = segmentStart + mentionIndex
    return {
      type: 'file',
      query: text.slice(start + 1, cursor),
      start,
      end: cursor,
    }
  }

  if (segment.startsWith('/')) {
    return {
      type: 'capability',
      query: segment.slice(1),
      start: segmentStart,
      end: cursor,
    }
  }

  return null
}

export function removeComposerSuggestionTrigger(
  text: string,
  trigger: ComposerSuggestionTrigger,
): { text: string; cursor: number } {
  const before = text.slice(0, trigger.start)
  let after = text.slice(trigger.end)
  if (/\s$/.test(before) && /^\s/.test(after)) after = after.replace(/^\s+/, '')
  if (!before && /^\s/.test(after)) after = after.replace(/^\s+/, '')
  return { text: `${before}${after}`, cursor: before.length }
}

function normalizedPath(value: string): string {
  return value.replaceAll('\\', '/').toLocaleLowerCase()
}

function matchScore(file: WorkspaceFileEntry, query: string): number | null {
  if (!query) return 0
  const name = normalizedPath(file.name)
  const relativePath = normalizedPath(file.relativePath)
  const terms = query.split(/\s+/).filter(Boolean)
  if (!terms.every((term) => name.includes(term) || relativePath.includes(term))) return null
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (relativePath.startsWith(query)) return 2
  if (name.includes(query)) return 3
  if (relativePath.includes(query)) return 4
  return 5
}

export function searchWorkspaceFiles(
  files: readonly WorkspaceFileEntry[],
  query: string,
  selectedPaths: ReadonlySet<string>,
  limit = 40,
): WorkspaceFileEntry[] {
  const normalizedQuery = normalizedPath(query.trim().replace(/^\.\//, ''))
  return files
    .filter((file) => !selectedPaths.has(normalizedPath(file.path)))
    .map((file) => ({ file, score: matchScore(file, normalizedQuery) }))
    .filter((item): item is { file: WorkspaceFileEntry; score: number } => item.score !== null)
    .sort((left, right) => (
      left.score - right.score
      || left.file.relativePath.length - right.file.relativePath.length
      || left.file.relativePath.localeCompare(right.file.relativePath)
    ))
    .slice(0, Math.max(1, limit))
    .map((item) => item.file)
}
