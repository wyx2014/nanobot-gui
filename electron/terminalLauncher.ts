export interface WindowsTerminalLaunchSpec {
  command: 'cmd.exe';
  args: string[];
  options: {
    cwd: string;
    stdio: 'ignore';
    detached: true;
    windowsHide: false;
  };
}

/**
 * Launch a separate Command Prompt without interpolating the workspace path
 * into a command string. The new prompt inherits the outer process cwd, so
 * spaces and CMD metacharacters in the directory are never parsed by cmd.exe.
 */
export function createWindowsTerminalLaunchSpec(cwd: string): WindowsTerminalLaunchSpec {
  return {
    command: 'cmd.exe',
    args: ['/D', '/C', 'start', '', 'cmd.exe', '/D'],
    options: {
      cwd,
      stdio: 'ignore',
      detached: true,
      windowsHide: false,
    },
  };
}
