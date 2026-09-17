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
      { encoding: 'utf8' },
    );
    const metadata = JSON.parse(raw) as Record<string, string>;

    expect(metadata.target).toBe('win32-x64');
    expect(metadata.pythonVersion).toBe('3.12.9');
    expect(metadata.archive).toBe(
      'tpcowork-python-3.12.9-win32-x64-desktop-v2-bytecode.zip',
    );
    expect(metadata.checksum).toBe(`${metadata.archive}.sha256`);
    expect(metadata.releaseTag).toContain('3.12.9-win32-x64');
    expect(metadata.mode).toBe(
      metadata.host === 'win32-x64' ? 'build-on-host' : 'target-host-required',
    );
    expect(metadata).not.toHaveProperty('repository');
    expect(metadata).not.toHaveProperty('archiveUrl');
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
      { encoding: 'utf8' },
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

  it('builds, smoke-tests, and publishes the final NSIS installer on Windows CI', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'windows-python-runtime.yml'),
      'utf8',
    );

    expect(workflow).toContain('name: Build Windows Installer');
    expect(workflow).toContain('runs-on: windows-latest');
    expect(workflow).toContain('repository: ${{ inputs.nanobot_repository }}');
    expect(workflow).toContain('default: tpacowork-runtime');
    expect(workflow).toContain('run: npm ci');
    expect(workflow).toContain('Verify packaging contracts');
    expect(workflow).toContain('run: npm run build:win');
    expect(workflow).toContain(
      'TPCOWORK_IMAGE_EXTRACT_API_KEY: ${{ secrets.TPCOWORK_IMAGE_EXTRACT_API_KEY }}',
    );
    expect(workflow).toContain('win-unpacked/resources/python/python.exe');
    expect(workflow).toContain('import nanobot; from nanobot.cli.commands import app');
    expect(workflow).toContain('Get-FileHash');
    expect(workflow).toContain('actions/upload-artifact@v4');
    expect(workflow).toContain('name: TPCowork-${{ steps.package.outputs.version }}-windows-x64');
    expect(workflow).toContain('GH_TOKEN: ${{ github.token }}');
    expect(workflow).toContain('gh release create $env:RELEASE_TAG --prerelease');
    expect(workflow).toContain('gh release upload $env:RELEASE_TAG');
    expect(workflow).toContain('--clobber');
    expect(workflow).not.toContain('node scripts/package-python-runtime.mjs');
  });

  it('builds, smoke-tests, and publishes AppImage and DEB packages on Linux CI', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'linux-python-runtime.yml'),
      'utf8',
    );

    expect(workflow).toContain('name: Build Linux Packages');
    expect(workflow).toContain('runs-on: ubuntu-22.04');
    expect(workflow).toContain('repository: ${{ inputs.nanobot_repository }}');
    expect(workflow).toContain('run: npm ci');
    expect(workflow).toContain('Verify packaging contracts');
    expect(workflow).toContain('run: npm run build:linux');
    expect(workflow).toContain(
      'TPCOWORK_IMAGE_EXTRACT_API_KEY: ${{ secrets.TPCOWORK_IMAGE_EXTRACT_API_KEY }}',
    );
    expect(workflow).toContain('--appimage-extract');
    expect(workflow).toContain('dpkg-deb --extract');
    expect(workflow).toContain('deb_root/usr/share/applications');
    expect(workflow).toContain("grep -q '^Exec='");
    expect(workflow).toContain('resources/python/bin/python3');
    expect(workflow).toContain('find squashfs-root/resources/python -xtype l');
    expect(workflow).toContain('nanobot-gui/${{ steps.package.outputs.appimage }}');
    expect(workflow).toContain('nanobot-gui/${{ steps.package.outputs.deb }}');
    expect(workflow).toContain('linux-packages-$version');
    expect(workflow).toContain('DEB_NAME: ${{ steps.package.outputs.deb_name }}');
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

  it('requires Windows runtime assembly to run on a Windows x64 host', () => {
    const preparationScript = fs.readFileSync(
      path.join(process.cwd(), 'scripts', 'download-python.mjs'),
      'utf8',
    );

    expect(preparationScript).toContain("'target-host-required'");
    expect(preparationScript).toContain('runtime must be prepared on its target host');
    expect(preparationScript).not.toContain('download-prebuilt');
    expect(preparationScript).not.toContain('installPrebuiltWindowsRuntime');
    expect(preparationScript).not.toContain('TPCOWORK_WINDOWS_RUNTIME_URL');
    expect(preparationScript).not.toContain('TPACOWORK_WINDOWS_RUNTIME_URL');
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
