import fs from 'fs/promises'
import path from 'path'

export interface WorkspaceFileEntry {
  kind: 'file' | 'folder'
  name: string
  path: string
  relativePath: string
}

const DEFAULT_FILE_LIMIT = 5_000
const DEFAULT_DIRECTORY_LIMIT = 2_000
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'embedded-python',
  'node_modules',
  'out',
  'target',
  'temp',
  'tmp',
  'venv',
])

function compareNames(left: string, right: string): number {
  const a = left.toLocaleLowerCase()
  const b = right.toLocaleLowerCase()
  if (a < b) return -1
  if (a > b) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export async function listWorkspaceFiles(
  workspacePath: string,
  options: { fileLimit?: number; directoryLimit?: number } = {},
): Promise<WorkspaceFileEntry[]> {
  if (!workspacePath.trim()) throw new Error('workspace path is required')

  const requestedRoot = path.resolve(workspacePath)
  const root = await fs.realpath(requestedRoot)
  const rootStats = await fs.stat(root)
  if (!rootStats.isDirectory()) throw new Error('workspace path must be a directory')

  const fileLimit = Math.max(1, options.fileLimit ?? DEFAULT_FILE_LIMIT)
  const directoryLimit = Math.max(1, options.directoryLimit ?? DEFAULT_DIRECTORY_LIMIT)
  const results: WorkspaceFileEntry[] = []
  const pendingDirectories: Array<{ absolutePath: string; relativePath: string }> = [{
    absolutePath: root,
    relativePath: '',
  }]
  let visitedDirectories = 0

  while (
    pendingDirectories.length > 0
    && results.length < fileLimit
    && visitedDirectories < directoryLimit
  ) {
    const current = pendingDirectories.shift()!
    visitedDirectories += 1

    let entries
    try {
      entries = await fs.readdir(current.absolutePath, { withFileTypes: true })
    } catch (error) {
      // A workspace can contain unreadable subdirectories. Keep the rest searchable.
      if (!current.relativePath) throw error
      continue
    }
    entries.sort((left, right) => compareNames(left.name, right.name))

    for (const entry of entries) {
      if (results.length >= fileLimit) break
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue

      const absolutePath = path.join(current.absolutePath, entry.name)
      if (!isWithinRoot(root, absolutePath)) continue
      const relativePath = current.relativePath
        ? `${current.relativePath}/${entry.name}`
        : entry.name

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORY_NAMES.has(entry.name.toLocaleLowerCase())) {
          results.push({
            kind: 'folder',
            name: entry.name,
            path: path.join(requestedRoot, ...relativePath.split('/')),
            relativePath,
          })
          pendingDirectories.push({ absolutePath, relativePath })
        }
      } else if (entry.isFile()) {
        results.push({
          kind: 'file',
          name: entry.name,
          path: path.join(requestedRoot, ...relativePath.split('/')),
          relativePath,
        })
      }
    }
  }

  return results.sort((left, right) => compareNames(left.relativePath, right.relativePath))
}
