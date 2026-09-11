import { describe, expect, it } from 'vitest'
import {
  findComposerSuggestionTrigger,
  removeComposerSuggestionTrigger,
  searchWorkspaceFiles,
} from './composerSuggestions'

const files = [
  { kind: 'file' as const, name: 'report.md', path: '/workspace/archive/report.md', relativePath: 'archive/report.md' },
  { kind: 'file' as const, name: 'quarterly.xlsx', path: '/workspace/reports/quarterly.xlsx', relativePath: 'reports/quarterly.xlsx' },
  { kind: 'file' as const, name: 'report.md', path: '/workspace/report.md', relativePath: 'report.md' },
  { kind: 'folder' as const, name: 'reports', path: '/workspace/reports', relativePath: 'reports' },
]

describe('composer suggestion triggers', () => {
  it('finds a file mention at the cursor without requiring it at the start of the message', () => {
    const text = '请总结 @reports/quar'
    expect(findComposerSuggestionTrigger(text, text.length)).toEqual({
      type: 'file',
      query: 'reports/quar',
      start: 4,
      end: text.length,
    })
  })

  it('keeps slashes inside an @ file query and detects slash capabilities separately', () => {
    expect(findComposerSuggestionTrigger('@src/components/Chat', 20)?.type).toBe('file')
    expect(findComposerSuggestionTrigger('请使用 /writer', 11)).toEqual({
      type: 'capability',
      query: 'writer',
      start: 4,
      end: 11,
    })
  })

  it('does not treat an email address as a workspace file mention', () => {
    const text = '联系 analyst@example.com'
    expect(findComposerSuggestionTrigger(text, text.length)).toBeNull()
  })

  it('removes only the active trigger token after a structured item is selected', () => {
    const text = '请总结 @report 后给出建议'
    const trigger = findComposerSuggestionTrigger(text, 11)!
    expect(removeComposerSuggestionTrigger(text, trigger)).toEqual({
      text: '请总结 后给出建议',
      cursor: 4,
    })
  })
})

describe('workspace file search', () => {
  it('ranks an exact basename first and excludes selected files', () => {
    const result = searchWorkspaceFiles(
      files,
      'report.md',
      new Set(['/workspace/report.md']),
    )
    expect(result.map((file) => file.relativePath)).toEqual(['archive/report.md'])
  })

  it('matches normalized relative paths', () => {
    const result = searchWorkspaceFiles(files, 'reports\\quarter', new Set())
    expect(result.map((file) => file.relativePath)).toEqual(['reports/quarterly.xlsx'])
  })

  it('returns folders alongside files and preserves their type', () => {
    const result = searchWorkspaceFiles(files, 'reports', new Set())
    expect(result[0]).toMatchObject({ kind: 'folder', relativePath: 'reports' })
    expect(result.map((entry) => entry.relativePath)).toContain('reports/quarterly.xlsx')
  })
})
