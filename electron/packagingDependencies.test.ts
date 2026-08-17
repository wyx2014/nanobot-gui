import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  build?: {
    win?: {
      compression?: string;
      target?: string[];
    };
    nsis?: {
      include?: string;
    };
  };
}

const packageManifest = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
) as PackageManifest;

const electronViteConfig = fs.readFileSync(
  path.join(process.cwd(), 'electron.vite.config.ts'),
  'utf8',
);
const installerInclude = fs.readFileSync(
  path.join(process.cwd(), 'build', 'installer.nsh'),
  'utf8',
);

describe('packaged dependency boundary', () => {
  it('ships only the Node module required by the Electron main process', () => {
    expect(Object.keys(packageManifest.dependencies ?? {}).sort()).toEqual(['ws']);
  });

  it('does not restore unused heavyweight dependencies', () => {
    const declaredDependencies = {
      ...packageManifest.dependencies,
      ...packageManifest.devDependencies,
    };

    for (const packageName of [
      '@mozilla/readability',
      '@tanstack/react-virtual',
      'node-llama-cpp',
      'three',
      'turndown',
      'zod',
    ]) {
      expect(declaredDependencies).not.toHaveProperty(packageName);
    }
  });

  it('does not externalize the removed llama runtime', () => {
    expect(electronViteConfig).not.toContain('node-llama-cpp');
  });

  it('builds one compressed Windows release target by default', () => {
    expect(packageManifest.build?.win?.compression).toBe('normal');
    expect(packageManifest.build?.win?.target).toEqual(['nsis']);
    expect(packageManifest.scripts?.['prepare-python:win'])
      .toBe('node scripts/download-python.mjs --target win32-x64');
    expect(packageManifest.scripts?.['build:win'])
      .toContain('npm run prepare-python:win');
    expect(packageManifest.scripts?.['build:win']).toContain('--win nsis');
    expect(packageManifest.scripts?.['build:win:portable'])
      .toContain('npm run prepare-python:win');
    expect(packageManifest.scripts?.['build:win:portable']).toContain('--win portable');
  });

  it('resets the installation marker only for a real uninstall', () => {
    expect(packageManifest.build?.nsis?.include).toBe('build/installer.nsh');
    expect(installerInclude).toContain('${ifNot} ${isUpdated}');
    expect(installerInclude).toContain('Delete "$APPDATA\\tpacowork\\.installation-id"');
  });
});
