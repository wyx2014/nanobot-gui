import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('cross-platform Python runtime packaging', () => {
  it('pins the Windows runtime contract to Python 3.12.9 and win32-x64', () => {
    const raw = execFileSync(
      process.execPath,
      [
        path.join(process.cwd(), 'scripts', 'download-python.mjs'),
        '--target',
        'win32-x64',
        '--print-config',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TPCOWORK_RUNTIME_REPOSITORY: 'example/tpcowork',
        },
      },
    );
    const metadata = JSON.parse(raw) as Record<string, string>;

    expect(metadata.target).toBe('win32-x64');
    expect(metadata.pythonVersion).toBe('3.12.9');
    expect(metadata.repository).toBe('example/tpcowork');
    expect(metadata.archive).toBe(
      'tpcowork-python-3.12.9-win32-x64-desktop-v2-bytecode.zip',
    );
    expect(metadata.checksum).toBe(`${metadata.archive}.sha256`);
    expect(metadata.releaseTag).toContain('3.12.9-win32-x64');
    expect(metadata.archiveUrl).toContain(metadata.releaseTag);
    expect(metadata.archiveUrl).toContain(metadata.archive);
  });

  it('accepts the previous runtime repository variable during brand migration', () => {
    const raw = execFileSync(
      process.execPath,
      [
        path.join(process.cwd(), 'scripts', 'download-python.mjs'),
        '--target',
        'win32-x64',
        '--print-config',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TPCOWORK_RUNTIME_REPOSITORY: '',
          TPACOWORK_RUNTIME_REPOSITORY: 'example/previous-brand',
        },
      },
    );

    expect(JSON.parse(raw).repository).toBe('example/previous-brand');
  });

  it('pins the Linux runtime contract to Python 3.12.9 and linux-x64', () => {
    const raw = execFileSync(
      process.execPath,
      [
        path.join(process.cwd(), 'scripts', 'download-python.mjs'),
        '--target',
        'linux-x64',
        '--print-config',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          TPCOWORK_RUNTIME_REPOSITORY: 'example/tpcowork',
        },
      },
    );
    const metadata = JSON.parse(raw) as Record<string, string>;

    expect(metadata.target).toBe('linux-x64');
    expect(metadata.pythonVersion).toBe('3.12.9');
    expect(metadata.archive).toBe(
      'tpcowork-python-3.12.9-linux-x64-desktop-v2-bytecode.tar.gz',
    );
    expect(metadata.checksum).toBe(`${metadata.archive}.sha256`);
    expect(metadata.releaseTag).toContain('3.12.9-linux-x64');
    expect(metadata.mode).toBe(
      metadata.host === 'linux-x64' ? 'build-on-host' : 'target-host-required',
    );
  });

  it('builds and publishes the prebuilt runtime on a Windows CI runner', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'windows-python-runtime.yml'),
      'utf8',
    );

    expect(workflow).toContain('runs-on: windows-latest');
    expect(workflow).toContain('repository: ${{ inputs.nanobot_repository }}');
    expect(workflow).toContain('node scripts/download-python.mjs --target win32-x64');
    expect(workflow).toContain('node scripts/package-python-runtime.mjs --target win32-x64');
    expect(workflow).toContain('gh release create $env:RUNTIME_TAG --prerelease');
    expect(workflow).toContain('gh release upload');
    expect(workflow).toContain('--clobber');
  });

  it('builds, smoke-tests, and publishes the final AppImage on a Linux CI runner', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'linux-python-runtime.yml'),
      'utf8',
    );

    expect(workflow).toContain('name: Build Linux AppImage');
    expect(workflow).toContain('runs-on: ubuntu-22.04');
    expect(workflow).toContain('repository: ${{ inputs.nanobot_repository }}');
    expect(workflow).toContain('run: npm ci');
    expect(workflow).toContain('Verify packaging contracts');
    expect(workflow).toContain('run: npm run build:linux');
    expect(workflow).toContain('--appimage-extract');
    expect(workflow).toContain('resources/python/bin/python3');
    expect(workflow).toContain('find squashfs-root/resources/python -xtype l');
    expect(workflow).toContain('nanobot-gui/${{ steps.package.outputs.appimage }}');
    expect(workflow).toContain('gh release create "$RELEASE_TAG" --prerelease');
    expect(workflow).toContain('gh release upload "$RELEASE_TAG"');
    expect(workflow).toContain('--clobber');
  });

  it('requires Linux runtime assembly to run on a Linux x64 host', () => {
    const preparationScript = fs.readFileSync(
      path.join(process.cwd(), 'scripts', 'download-python.mjs'),
      'utf8',
    );

    expect(preparationScript).toContain("'target-host-required'");
    expect(preparationScript).toContain('runtime must be prepared on its target host');
    expect(preparationScript).not.toContain('TPCOWORK_LINUX_RUNTIME_URL');
  });

  it('does not build nanobot browser assets for the native desktop gateway', () => {
    const preparationScript = fs.readFileSync(
      path.join(process.cwd(), 'scripts', 'download-python.mjs'),
      'utf8',
    );

    expect(preparationScript).toContain("NANOBOT_SKIP_WEBUI_BUILD: '1'");
    expect(preparationScript).toContain("PREVIOUS_RUNTIME_MARKER_NAME = '.tpacowork-runtime.json'");
    expect(preparationScript).toContain("PREVIOUS_SOURCE_MARKER_NAME = '.tpacowork-nanobot-source.sha256'");
  });
});
