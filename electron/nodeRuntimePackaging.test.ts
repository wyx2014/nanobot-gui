import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('bundled task Node/npm', () => {
  it.each(['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'])('resolves the distribution and packaged npm path for %s', (target) => {
    const config = JSON.parse(execFileSync(process.execPath, ['scripts/download-node.mjs', '--target', target, '--print-config'], { encoding: 'utf8' }));
    expect(config.target).toBe(target);
    expect(config.url).toMatch(/^https:\/\/nodejs.org\/dist\/v22\.22\.1\/node-v22\.22\.1-/);
    expect(config.node).toBe(target.startsWith('win32') ? 'node.exe' : 'bin/node');
    expect(config.npm).toBe(target.startsWith('win32')
      ? 'npm/bin/npm-cli.js'
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
    expect(workflow).toContain('resources/node/npm/bin/npm-cli.js');
    expect(workflow).toContain('resources/node/npx.cmd');
    expect(workflow).not.toContain('resources/node/node_modules/npm');
  });
});
