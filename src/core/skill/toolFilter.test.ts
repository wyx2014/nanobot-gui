import { describe, it, expect } from 'vitest';
import { matchesToolName, matchesToolPattern, parseToolPatterns, filterToolsByPatterns } from './toolFilter';

describe('matchesToolName', () => {
  it('matches exact tool name', () => {
    expect(matchesToolName('read_file', 'read_file')).toBe(true);
    expect(matchesToolName('read_file', 'write_file')).toBe(false);
  });

  it('matches wildcard prefix', () => {
    expect(matchesToolName('mcp__github__list_repos', 'mcp__github__*')).toBe(true);
    expect(matchesToolName('mcp__slack__post', 'mcp__github__*')).toBe(false);
  });

  it('matches wildcard anywhere', () => {
    expect(matchesToolName('mcp__github__list', '*github*')).toBe(true);
  });

  it('matches tool name from pattern with constraint', () => {
    expect(matchesToolName('run_command', 'run_command(npm run *)')).toBe(true);
    expect(matchesToolName('write_file', 'run_command(npm run *)')).toBe(false);
  });
});

describe('matchesToolPattern', () => {
  it('matches exact name without constraint', () => {
    expect(matchesToolPattern('read_file', 'read_file')).toBe(true);
  });

  it('validates command prefix constraint', () => {
    expect(matchesToolPattern('run_command', 'run_command(npm run *)', { command: 'npm run build' })).toBe(true);
    expect(matchesToolPattern('run_command', 'run_command(npm run *)', { command: 'rm -rf /' })).toBe(false);
  });

  it('validates path constraint', () => {
    expect(matchesToolPattern('write_file', 'write_file(/src/*)', { path: '/src/index.ts' })).toBe(true);
    expect(matchesToolPattern('write_file', 'write_file(/src/*)', { path: '/etc/passwd' })).toBe(false);
  });

  it('validates agent name constraint', () => {
    expect(matchesToolPattern('delegate_to_agent', 'delegate_to_agent(coder)', { agent_name: 'coder' })).toBe(true);
    expect(matchesToolPattern('delegate_to_agent', 'delegate_to_agent(coder)', { agent_name: 'researcher' })).toBe(false);
  });

  it('validates domain constraint', () => {
    expect(matchesToolPattern('http_fetch', 'http_fetch(domain:github.com)', { url: 'https://github.com/repo' })).toBe(true);
    expect(matchesToolPattern('http_fetch', 'http_fetch(domain:github.com)', { url: 'https://evil.com' })).toBe(false);
  });

  it('returns false for no input when constraint exists', () => {
    expect(matchesToolPattern('run_command', 'run_command(npm *)')).toBe(false);
  });

  it('returns true for name-only pattern regardless of input', () => {
    expect(matchesToolPattern('read_file', 'read_file', { path: '/anything' })).toBe(true);
  });
});

describe('parseToolPatterns', () => {
  it('returns tool names and validators', () => {
    const { allowedToolNames, inputValidators } = parseToolPatterns([
      'read_file',
      'run_command(npm *)',
      'mcp__github__*',
    ]);

    expect(allowedToolNames.has('read_file')).toBe(true);
    expect(allowedToolNames.has('run_command')).toBe(true);
    expect(allowedToolNames.has('mcp__github__*')).toBe(true);

    // run_command should have a validator
    expect(inputValidators.has('run_command')).toBe(true);
    expect(inputValidators.get('run_command')!({ command: 'npm test' })).toBe(true);
    expect(inputValidators.get('run_command')!({ command: 'rm -rf /' })).toBe(false);

    // read_file should NOT have a validator
    expect(inputValidators.has('read_file')).toBe(false);
  });
});

describe('filterToolsByPatterns', () => {
  it('filters tool names by patterns', () => {
    const tools = ['read_file', 'write_file', 'run_command', 'mcp__github__list', 'mcp__slack__post'];
    const patterns = ['read_file', 'mcp__github__*'];

    expect(filterToolsByPatterns(tools, patterns)).toEqual(['read_file', 'mcp__github__list']);
  });
});
