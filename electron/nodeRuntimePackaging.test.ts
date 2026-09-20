import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeWindowsNpmPortable } from '../scripts/windows-npm-runtime.mjs';

describe('bundled task Node/npm', () => {
  it.each(['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'])('resolves the distribution and packaged npm path for %s', (target) => {
    const config = JSON.parse(execFileSync(process.execPath, ['scripts/download-node.mjs', '--target', target, '--print-config'], { encoding: 'utf8' }));
    expect(config.target).toBe(target);
    expect(config.url).toMatch(/^https:\/\/nodejs.org\/dist\/v22\.22\.1\/node-v22\.22\.1-/);
    expect(config.node).toBe(target.startsWith('win32') ? 'node.exe' : 'bin/node');
    expect(config.npm).toBe(target.startsWith('win32')
      ? 'npm-runtime/bin/npm-cli.js'
      : 'lib/node_modules/npm/bin/npm-cli.js');
    expect(config.npm).not.toMatch(/^node_modules\//);
    expect(config.npx).toBe(target.startsWith('win32') ? 'npx.cmd' : 'bin/npx');
  });

  it('includes Node/npm in each installer build and in Electron resources', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    for (const target of ['win', 'win:portable', 'mac', 'linux']) {
      expect(pkg.scripts[`build:${target}`]).toContain('npm run prepare-node');
    }
    expect(pkg.build.extraResources).toContainEqual({ from: 'embedded-node/runtime/', to: 'node/', filter: ['**/*'] });
  });

  it.each(['windows-python-runtime.yml', 'linux-python-runtime.yml'])('runs the Node packaging contract in %s', (name) => {
    const workflow = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', name), 'utf8');
    expect(workflow).toContain('electron/nodeRuntimePackaging.test.ts');
  });

  it('smoke-tests Windows npm outside the filtered root node_modules directory', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'windows-python-runtime.yml'),
      'utf8',
    );
    expect(workflow).toContain('resources/node/npm-runtime/bin/npm-cli.js');
    expect(workflow).toContain('resources/node/npm.cmd');
    expect(workflow).toContain('resources/node/npx.cmd');
    expect(workflow).not.toContain('resources/node/node_modules/npm');
  });

  it('relocates the npm package while preserving and rewriting every Windows launcher', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tpcowork Windows npm '));
    const launchers = ['npm', 'npm.cmd', 'npm.ps1', 'npx', 'npx.cmd', 'npx.ps1'];
    try {
      const packageDir = path.join(directory, 'node_modules', 'npm');
      fs.mkdirSync(path.join(packageDir, 'bin'), { recursive: true });
      fs.mkdirSync(path.join(packageDir, 'node_modules', 'fixture-dependency'), { recursive: true });
      fs.writeFileSync(path.join(packageDir, 'node_modules', 'fixture-dependency', 'index.js'), 'module.exports = "npm dependency loaded";');
      for (const name of ['npm-cli.js', 'npx-cli.js', 'npm-prefix.js']) {
        fs.writeFileSync(path.join(packageDir, 'bin', name), 'console.log(require("fixture-dependency"));');
      }
      for (const name of launchers) {
        // Official sh, cmd and PowerShell launchers resolve both a prefix
        // helper and a CLI. Global-prefix lookups must keep their normal path.
        const command = name.startsWith('npm') ? 'npm' : 'npx';
        const base = name.endsWith('.cmd') ? '%~dp0\\node_modules\\npm'
          : name.endsWith('.ps1') ? '$PSScriptRoot/node_modules/npm' : '$CLI_BASEDIR/node_modules/npm';
        const separator = name.endsWith('.cmd') ? '\\' : '/';
        fs.writeFileSync(path.join(directory, name), [
          `${base}${separator}bin${separator}npm-prefix.js`,
          `${base}${separator}bin${separator}${command}-cli.js`,
          `$NPM_PREFIX/node_modules/npm/bin/${command}-cli.js`,
        ].join('\r\n'));
      }

      await makeWindowsNpmPortable(directory);

      expect(fs.existsSync(packageDir)).toBe(false);
      for (const name of launchers) {
        const launcher = path.join(directory, name);
        expect(fs.statSync(launcher).isFile()).toBe(true);
        const command = name.startsWith('npm') ? 'npm' : 'npx';
        const contents = fs.readFileSync(launcher, 'utf8');
        const base = name.endsWith('.cmd') ? '%~dp0\\npm-runtime'
          : name.endsWith('.ps1') ? '$PSScriptRoot/npm-runtime' : '$CLI_BASEDIR/npm-runtime';
        const separator = name.endsWith('.cmd') ? '\\' : '/';
        expect(contents).toContain(`${base}${separator}bin${separator}npm-prefix.js`);
        expect(contents).toContain(`${base}${separator}bin${separator}${command}-cli.js`);
        expect(contents).toContain(`$NPM_PREFIX/node_modules/npm/bin/${command}-cli.js`);
      }
      for (const name of ['npm-cli.js', 'npx-cli.js']) {
        expect(execFileSync(process.execPath, [path.join(directory, 'npm-runtime', 'bin', name)], {
          encoding: 'utf8',
        }).trim()).toBe('npm dependency loaded');
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
