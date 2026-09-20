import fs from 'node:fs/promises';
import path from 'node:path';

export const WINDOWS_NPM_DIRECTORY = 'npm-runtime';
export const WINDOWS_NPM_LAYOUT = 'portable-npm-v2';

export async function makeWindowsNpmPortable(directory) {
  // The official ZIP already contains a root "npm" launcher file. Keep the
  // package in a distinct directory, outside electron-builder's root
  // node_modules filter, without replacing any of the six launchers.
  await fs.rename(
    path.join(directory, 'node_modules', 'npm'),
    path.join(directory, WINDOWS_NPM_DIRECTORY),
  );
  for (const name of ['npm', 'npm.cmd', 'npm.ps1', 'npx', 'npx.cmd', 'npx.ps1']) {
    const launcher = path.join(directory, name);
    const contents = await fs.readFile(launcher, 'utf8');
    const rewritten = contents
      .replaceAll('$CLI_BASEDIR/node_modules/npm', `$CLI_BASEDIR/${WINDOWS_NPM_DIRECTORY}`)
      .replaceAll('%~dp0\\node_modules\\npm', `%~dp0\\${WINDOWS_NPM_DIRECTORY}`)
      .replaceAll('$PSScriptRoot/node_modules/npm', `$PSScriptRoot/${WINDOWS_NPM_DIRECTORY}`);
    if (rewritten === contents) throw new Error(`Unable to rewrite bundled ${name} launcher`);
    await fs.writeFile(launcher, rewritten);
  }
}
