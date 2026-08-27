import { describe, expect, it } from 'vitest';
import { createWindowsTerminalLaunchSpec } from './terminalLauncher';

describe('createWindowsTerminalLaunchSpec', () => {
  it('passes a Windows workspace as cwd instead of embedding it in CMD syntax', () => {
    const cwd = 'C:\\Users\\1\\Documents\\TPCowork Projects\\123123';

    const launch = createWindowsTerminalLaunchSpec(cwd);

    expect(launch.command).toBe('cmd.exe');
    expect(launch.args).toEqual(['/D', '/C', 'start', '', 'cmd.exe', '/D']);
    expect(launch.options.cwd).toBe(cwd);
    expect(launch.args.join(' ')).not.toContain(cwd);
  });

  it('does not expose CMD metacharacters from the workspace path to the command line', () => {
    const cwd = 'C:\\Work\\研发 & 财务 (2026)';

    const launch = createWindowsTerminalLaunchSpec(cwd);

    expect(launch.options.cwd).toBe(cwd);
    expect(launch.args.join(' ')).not.toContain('&');
    expect(launch.args.join(' ')).not.toContain('(');
  });
});
