import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { listWorkspaceFiles } from './workspaceFiles'

const temporaryDirectories: string[] = []

async function createWorkspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tpcowork-files-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )))
})

describe('listWorkspaceFiles', () => {
  it('returns searchable relative paths and skips generated or hidden directories', async () => {
    const root = await createWorkspace()
    await fs.mkdir(path.join(root, 'reports', '2026'), { recursive: true })
    await fs.mkdir(path.join(root, 'node_modules', 'package'), { recursive: true })
    await fs.mkdir(path.join(root, '.git'), { recursive: true })
    await fs.writeFile(path.join(root, 'README.md'), 'readme')
    await fs.writeFile(path.join(root, 'reports', '2026', 'quarterly.xlsx'), 'sheet')
    await fs.writeFile(path.join(root, 'node_modules', 'package', 'index.js'), 'ignored')
    await fs.writeFile(path.join(root, '.git', 'config'), 'ignored')

    await expect(listWorkspaceFiles(root)).resolves.toEqual([
      {
        kind: 'file',
        name: 'README.md',
        path: path.join(root, 'README.md'),
        relativePath: 'README.md',
      },
      {
        kind: 'folder',
        name: 'reports',
        path: path.join(root, 'reports'),
        relativePath: 'reports',
      },
      {
        kind: 'folder',
        name: '2026',
        path: path.join(root, 'reports', '2026'),
        relativePath: 'reports/2026',
      },
      {
        kind: 'file',
        name: 'quarterly.xlsx',
        path: path.join(root, 'reports', '2026', 'quarterly.xlsx'),
        relativePath: 'reports/2026/quarterly.xlsx',
      },
    ])
  })

  it('respects the file limit for large workspaces', async () => {
    const root = await createWorkspace()
    await Promise.all([
      fs.writeFile(path.join(root, 'a.txt'), 'a'),
      fs.writeFile(path.join(root, 'b.txt'), 'b'),
      fs.writeFile(path.join(root, 'c.txt'), 'c'),
    ])

    const files = await listWorkspaceFiles(root, { fileLimit: 2 })

    expect(files).toHaveLength(2)
    expect(files.map((file) => file.relativePath)).toEqual(['a.txt', 'b.txt'])
  })
})
