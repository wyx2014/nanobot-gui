import { execFileSync, execSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_TAG = '20250212';
const PYTHON_VERSION = '3.12.9';
const RUNTIME_PROFILE = 'desktop-v1';

const TARGETS = {
  'darwin-arm64': `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-aarch64-apple-darwin-install_only.tar.gz`,
  'darwin-x64':   `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-x86_64-apple-darwin-install_only.tar.gz`,
  'win32-x64':    `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-x86_64-pc-windows-msvc-install_only.tar.gz`,
};

const key = `${process.platform}-${process.arch}`;
const tarball = TARGETS[key];
if (!tarball) {
  console.error(`Unsupported platform/architecture: ${key}`);
  process.exit(1);
}

const destDir = path.join(__dirname, '..', 'embedded-python', 'runtime');
const nanobotSrc = path.resolve(__dirname, '..', '..', 'nanobot');
const nanobotPyproject = path.join(nanobotSrc, 'pyproject.toml');
const dependencySpecSha256 = createHash('sha256')
  .update(fs.readFileSync(nanobotPyproject))
  .digest('hex');
const runtimeMarkerPath = path.join(destDir, '.tpacowork-runtime.json');
const expectedRuntimeMarker = {
  target: key,
  pythonVersion: PYTHON_VERSION,
  releaseTag: RELEASE_TAG,
  profile: RUNTIME_PROFILE,
  dependencySpecSha256,
};
const pythonBin = process.platform === 'win32'
  ? path.join(destDir, 'python.exe')
  : path.join(destDir, 'bin', 'python3');

function readRuntimeMarker() {
  try {
    return JSON.parse(fs.readFileSync(runtimeMarkerPath, 'utf8'));
  } catch {
    return null;
  }
}

function runtimeMarkerMatches(marker) {
  return marker != null
    && Object.entries(expectedRuntimeMarker).every(([name, value]) => marker[name] === value);
}

function writeRuntimeMarker() {
  fs.writeFileSync(
    runtimeMarkerPath,
    `${JSON.stringify(expectedRuntimeMarker, null, 2)}\n`,
    'utf8',
  );
}

function pruneRuntime(rootDir) {
  const pruneDirNames = new Set(['__pycache__', 'test', 'tests']);
  let removedDirs = 0;
  let removedFiles = 0;

  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (pruneDirNames.has(entry.name)) {
          fs.rmSync(entryPath, { recursive: true, force: true });
          removedDirs += 1;
        } else {
          visit(entryPath);
        }
      } else if (entry.isFile() && /\.(pyc|pyo)$/.test(entry.name)) {
        fs.rmSync(entryPath, { force: true });
        removedFiles += 1;
      }
    }
  };

  visit(rootDir);
  console.log(`Pruned Python runtime: removed ${removedDirs} directories and ${removedFiles} cache files.`);
}

if (fs.existsSync(pythonBin) && runtimeMarkerMatches(readRuntimeMarker())) {
  console.log(`Python already present for ${key}, skipping download.`);
  pruneRuntime(destDir);
  process.exit(0);
}

if (fs.existsSync(destDir)) {
  console.log(`Python runtime cache is stale for ${key}; rebuilding the ${RUNTIME_PROFILE} profile.`);
  fs.rmSync(destDir, { recursive: true, force: true });
}

const BASE_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_TAG}`;
const url = `${BASE_URL}/${tarball.replace('+', '%2B')}`;
console.log(`Downloading ${url}...`);
fs.mkdirSync(destDir, { recursive: true });

const tmpTarball = path.join(destDir, 'tmp.tar.gz');

try {
  if (process.platform === 'win32') {
    execSync(`curl -L "${url}" -o "${tmpTarball}"`, { stdio: 'inherit' });
    execSync(`tar -xf "${tmpTarball}" -C "${destDir}" --strip-components=1`, { stdio: 'inherit' });
    fs.unlinkSync(tmpTarball);
  } else {
    execSync(`curl -L "${url}" | tar -xz -C "${destDir}" --strip-components=1`, { stdio: 'inherit' });
  }

  // Install only the desktop gateway dependency profile. Chat-channel SDKs
  // and AWS Bedrock are optional nanobot extras and must not enter installers.
  const pip = process.platform === 'win32'
    ? path.join(destDir, 'Scripts', 'pip.exe')
    : path.join(destDir, 'bin', 'pip3');

  console.log(`Installing nanobot [desktop] dependencies from ${nanobotSrc}...`);
  execFileSync(
    pip,
    ['install', '--quiet', '--no-compile', '--no-cache-dir', `${nanobotSrc}[desktop]`],
    { stdio: 'inherit' },
  );
  pruneRuntime(destDir);
  writeRuntimeMarker();
  console.log('Done! Standalone Python is ready and configured.');
} catch (err) {
  console.error('Failed to configure standalone Python:', err);
  process.exit(1);
}
