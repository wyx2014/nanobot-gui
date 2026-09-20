import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('bundled task Node/npm', () => {
  it.each(['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'])('resolves the official distribution and npm path for %s', (target) => {
    const config = JSON.parse(execFileSync(process.execPath, ['scripts/download-node.mjs', '--target', target, '--print-config'], { encoding: 'utf8' }));
    expect(config.target).toBe(target);
    expect(config.url).toMatch(/^https:\/\/nodejs.org\/dist\/v22\.22\.1\/node-v22\.22\.1-/);
    expect(config.node).toBe(target.startsWith('win32') ? 'node.exe' : 'bin/node');
    expect(config.npm).toContain('node_modules/npm/bin/npm-cli.js');
    expect(config.npx).toBe(target.startsWith('win32') ? 'npx.cmd' : 'bin/npx');
  });

  it('includes Node/npm in each installer build and in Electron resources', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    for (const target of ['win', 'win:portable', 'mac', 'linux']) {
      expect(pkg.scripts[`build:${target}`]).toContain('npm run prepare-node');
    }
    expect(pkg.build.extraResources).toContainEqual({ from: 'embedded-node/runtime/', to: 'node/', filter: ['**/*'] });
  });
});
