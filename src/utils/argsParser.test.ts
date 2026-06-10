import { describe, it, expect } from 'vitest';
import { parseArgs } from './argsParser';

describe('parseArgs', () => {
  it('splits simple space-separated args', () => {
    expect(parseArgs('hello world')).toEqual(['hello', 'world']);
  });

  it('handles double-quoted strings', () => {
    expect(parseArgs('"path with spaces" --flag')).toEqual(['path with spaces', '--flag']);
  });

  it('handles single-quoted strings', () => {
    expect(parseArgs("'path with spaces' --flag")).toEqual(['path with spaces', '--flag']);
  });

  it('handles backslash escaping', () => {
    expect(parseArgs('path\\ with\\ spaces --flag')).toEqual(['path with spaces', '--flag']);
  });

  it('handles mixed quotes', () => {
    expect(parseArgs(`"double" 'single' plain`)).toEqual(['double', 'single', 'plain']);
  });

  it('handles empty input', () => {
    expect(parseArgs('')).toEqual([]);
  });

  it('handles whitespace-only input', () => {
    expect(parseArgs('   ')).toEqual([]);
  });

  it('handles multiple spaces between args', () => {
    expect(parseArgs('a   b   c')).toEqual(['a', 'b', 'c']);
  });

  it('handles tabs as separators', () => {
    expect(parseArgs("a\tb\tc")).toEqual(['a', 'b', 'c']);
  });

  it('preserves empty quoted strings', () => {
    expect(parseArgs('"" a')).toEqual(['', 'a']);
  });

  it('handles escaped quotes inside double quotes', () => {
    expect(parseArgs('"say \\"hello\\""')).toEqual(['say "hello"']);
  });

  it('does not interpret backslash inside single quotes', () => {
    expect(parseArgs("'a\\b'")).toEqual(['a\\b']);
  });

  it('handles real-world npx args', () => {
    expect(parseArgs('-y @anthropic/mcp-server-filesystem "/Users/me/my projects"')).toEqual([
      '-y',
      '@anthropic/mcp-server-filesystem',
      '/Users/me/my projects',
    ]);
  });

  it('handles trailing backslash', () => {
    expect(parseArgs('a\\')).toEqual(['a\\']);
  });
});
