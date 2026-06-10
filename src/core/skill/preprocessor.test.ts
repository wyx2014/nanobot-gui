import { describe, it, expect } from 'vitest';
import { substituteVariables } from './preprocessor';
import { parseArgs } from '../../utils/argsParser';

describe('parseArgs', () => {
  it('parses space-separated args', () => {
    expect(parseArgs('foo bar baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('handles quoted strings', () => {
    expect(parseArgs('"hello world" foo')).toEqual(['hello world', 'foo']);
    expect(parseArgs("'hello world' foo")).toEqual(['hello world', 'foo']);
  });

  it('returns empty array for empty string', () => {
    expect(parseArgs('')).toEqual([]);
    expect(parseArgs('   ')).toEqual([]);
  });

  it('handles mixed quotes', () => {
    expect(parseArgs('a "b c" d')).toEqual(['a', 'b c', 'd']);
  });
});

describe('substituteVariables', () => {
  const skillDir = '/Users/test/.ruyi/skills/my-skill';
  const sessionId = 'sess-123';

  it('replaces $ARGUMENTS with full args string', () => {
    const result = substituteVariables('Task: $ARGUMENTS', 'hello world', skillDir, sessionId);
    expect(result).toBe('Task: hello world');
  });

  it('replaces $0, $1, etc. with positional args', () => {
    const result = substituteVariables('First: $0, Second: $1 ($ARGUMENTS)', 'foo bar', skillDir, sessionId);
    expect(result).toBe('First: foo, Second: bar (foo bar)');
  });

  it('replaces $ARGUMENTS[N] with positional args', () => {
    const result = substituteVariables('$ARGUMENTS[0] and $ARGUMENTS[1]', 'a b', skillDir, sessionId);
    expect(result).toBe('a and b');
  });

  it('replaces ${ABU_SKILL_DIR}', () => {
    const result = substituteVariables('Dir: ${ABU_SKILL_DIR}', '', skillDir, sessionId);
    expect(result).toBe(`Dir: ${skillDir}`);
  });

  it('replaces ${ABU_SESSION_ID}', () => {
    const result = substituteVariables('Session: ${ABU_SESSION_ID}', '', skillDir, sessionId);
    expect(result).toBe('Session: sess-123');
  });

  it('replaces ${CLAUDE_SKILL_DIR} and ${CLAUDE_SESSION_ID} (compat)', () => {
    const result = substituteVariables(
      '${CLAUDE_SKILL_DIR} ${CLAUDE_SESSION_ID}',
      '',
      skillDir,
      sessionId,
    );
    expect(result).toBe(`${skillDir} sess-123`);
  });

  it('auto-appends ARGUMENTS when not referenced in content', () => {
    const result = substituteVariables('Do something', 'my args', skillDir, sessionId);
    expect(result).toBe('Do something\nARGUMENTS: my args');
  });

  it('does not auto-append when $ARGUMENTS is in content', () => {
    const result = substituteVariables('Task: $ARGUMENTS', 'my args', skillDir, sessionId);
    expect(result).not.toContain('\nARGUMENTS:');
  });

  it('does not auto-append when args is empty', () => {
    const result = substituteVariables('Do something', '', skillDir, sessionId);
    expect(result).toBe('Do something');
  });

  it('handles missing positional args gracefully (auto-appends ARGUMENTS)', () => {
    const result = substituteVariables('$0 $1 $2', 'only', skillDir, sessionId);
    expect(result).toBe('only  \nARGUMENTS: only');
  });

  it('handles all substitutions together', () => {
    const content = 'Run $0 in ${ABU_SKILL_DIR} with args: $ARGUMENTS (session: ${ABU_SESSION_ID})';
    const result = substituteVariables(content, 'test --verbose', skillDir, sessionId);
    expect(result).toBe(`Run test in ${skillDir} with args: test --verbose (session: sess-123)`);
  });
});
