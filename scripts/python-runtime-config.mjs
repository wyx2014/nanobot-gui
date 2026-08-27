export const PYTHON_VERSION = '3.12.9';
export const PYTHON_STANDALONE_RELEASE = '20250212';
export const RUNTIME_PROFILE = 'desktop-v2-bytecode';
export const WINDOWS_RUNTIME_TARGET = 'win32-x64';
export const DEFAULT_RUNTIME_REPOSITORY = 'wyx2014/nanobot-gui';

export const RUNTIME_TARGETS = {
  'darwin-arm64': `cpython-${PYTHON_VERSION}+${PYTHON_STANDALONE_RELEASE}-aarch64-apple-darwin-install_only.tar.gz`,
  'darwin-x64': `cpython-${PYTHON_VERSION}+${PYTHON_STANDALONE_RELEASE}-x86_64-apple-darwin-install_only.tar.gz`,
  'win32-x64': `cpython-${PYTHON_VERSION}+${PYTHON_STANDALONE_RELEASE}-x86_64-pc-windows-msvc-install_only.tar.gz`,
};

export function runtimeArchiveName(target) {
  return `tpcowork-python-${PYTHON_VERSION}-${target}-${RUNTIME_PROFILE}.zip`;
}

export function runtimeReleaseTag(target) {
  return `embedded-python-${PYTHON_VERSION}-${target}-${RUNTIME_PROFILE}`;
}

export function runtimeAssetMetadata(target) {
  const archive = runtimeArchiveName(target);
  return {
    target,
    pythonVersion: PYTHON_VERSION,
    pythonStandaloneRelease: PYTHON_STANDALONE_RELEASE,
    profile: RUNTIME_PROFILE,
    archive,
    checksum: `${archive}.sha256`,
    manifest: `${archive}.json`,
    releaseTag: runtimeReleaseTag(target),
  };
}
