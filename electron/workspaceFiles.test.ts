import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { importWorkspaceFile, listWorkspaceFiles } from './workspaceFiles'

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

describe('importWorkspaceFile', () => {
  it('copies external files into attachments without changing the original or overwriting a same-name file', async () => {
    const root = await createWorkspace()
    const external = await createWorkspace()
    const source = path.join(external, 'report.pdf')
    await fs.writeFile(source, 'source')
    await fs.mkdir(path.join(root, 'attachments'))
    await fs.writeFile(path.join(root, 'attachments', 'report.pdf'), 'existing')

    const first = await importWorkspaceFile(root, source)
    const second = await importWorkspaceFile(root, source)
    const canonicalRoot = await fs.realpath(root)

    expect(first).toBe(path.join(canonicalRoot, 'attachments', 'report (2).pdf'))
    expect(second).toBe(path.join(canonicalRoot, 'attachments', 'report (3).pdf'))
    expect(await fs.readFile(source, 'utf8')).toBe('source')
    expect(await fs.readFile(path.join(root, 'attachments', 'report.pdf'), 'utf8')).toBe('existing')
    expect(await fs.readFile(first, 'utf8')).toBe('source')
    expect((await listWorkspaceFiles(root)).map((file) => file.relativePath)).toContain('attachments/report (2).pdf')
  })

  it('uses existing workspace files without making another copy', async () => {
    const root = await createWorkspace()
    const source = path.join(root, 'notes.txt')
    await fs.writeFile(source, 'notes')

    await expect(importWorkspaceFile(root, source)).resolves.toBe(await fs.realpath(source))
    await expect(fs.readdir(root)).resolves.toEqual(['notes.txt'])
  })

  it('rejects directories and attachments folders that link outside the workspace', async () => {
    const root = await createWorkspace()
    const external = await createWorkspace()
    const source = path.join(external, 'notes.txt')
    await fs.writeFile(source, 'notes')

    await expect(importWorkspaceFile(root, external)).rejects.toThrow('source path must be a file')
    await fs.symlink(external, path.join(root, 'attachments'), 'dir')
    await expect(importWorkspaceFile(root, source)).rejects.toThrow('workspace attachments path must be a directory')
    await expect(fs.readdir(external)).resolves.toEqual(['notes.txt'])
  })
})
