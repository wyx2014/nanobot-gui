import { execFileSync, execSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_TAG = '20250212';
const PYTHON_VERSION = '3.12.9';
const RUNTIME_PROFILE = 'desktop-v2-bytecode';

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
const sourceMarkerPath = path.join(destDir, '.tpacowork-nanobot-source.sha256');
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
const pipBin = process.platform === 'win32'
  ? path.join(destDir, 'Scripts', 'pip.exe')
  : path.join(destDir, 'bin', 'pip3');
const pythonMajorMinor = PYTHON_VERSION.split('.').slice(0, 2).join('.');
const installedNanobotDir = process.platform === 'win32'
  ? path.join(destDir, 'Lib', 'site-packages', 'nanobot')
  : path.join(destDir, 'lib', `python${pythonMajorMinor}`, 'site-packages', 'nanobot');

function nanobotSourceDigest() {
  const hash = createHash('sha256');
  const ignoredDirs = new Set(['.git', '__pycache__', 'tests', 'venv', 'dist']);
  const includedExtensions = new Set(['.py', '.md', '.js', '.sh']);

  const visit = (entryPath, relativePath = '') => {
    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(entryPath).sort()) {
        if (ignoredDirs.has(name)) continue;
        visit(path.join(entryPath, name), path.join(relativePath, name));
      }
      return;
    }
    if (!includedExtensions.has(path.extname(entryPath))) return;
    hash.update(relativePath.replaceAll(path.sep, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(entryPath));
    hash.update('\0');
  };

  visit(path.join(nanobotSrc, 'nanobot'), 'nanobot');
  for (const name of ['pyproject.toml', 'hatch_build.py']) {
    const entryPath = path.join(nanobotSrc, name);
    if (fs.existsSync(entryPath)) visit(entryPath, name);
  }
  return hash.digest('hex');
}

const expectedSourceDigest = nanobotSourceDigest();

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

function installedSourceMatches() {
  try {
    return fs.readFileSync(sourceMarkerPath, 'utf8').trim() === expectedSourceDigest;
  } catch {
    return false;
  }
}

function writeSourceMarker() {
  fs.writeFileSync(sourceMarkerPath, `${expectedSourceDigest}\n`, 'utf8');
}

function installNanobot({ includeDependencies }) {
  // Compiling every third-party wheel adds roughly 16k files / 100 MB to the
  // installer. Compile only nanobot below: it is the hot startup path and
  // costs a few hundred cache files instead of doubling the runtime tree.
  const args = ['install', '--quiet', '--no-compile', '--no-cache-dir'];
  if (!includeDependencies) {
    args.push('--no-deps', '--force-reinstall');
  }
  args.push(includeDependencies ? `${nanobotSrc}[desktop]` : nanobotSrc);
  execFileSync(pipBin, args, { stdio: 'inherit' });
  if (!fs.existsSync(installedNanobotDir)) {
    throw new Error(`Installed nanobot package not found: ${installedNanobotDir}`);
  }
  execFileSync(
    pythonBin,
    [
      '-m', 'compileall', '-q', '-f',
      '--invalidation-mode', 'unchecked-hash',
      installedNanobotDir,
    ],
    { stdio: 'inherit' },
  );
}

function pruneRuntime(rootDir) {
  const pruneDirNames = new Set(['test', 'tests']);
  let removedDirs = 0;

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
      }
    }
  };

  visit(rootDir);
  console.log(`Pruned Python runtime: removed ${removedDirs} test directories; retained bytecode caches.`);
}

if (fs.existsSync(pythonBin) && runtimeMarkerMatches(readRuntimeMarker())) {
  if (!installedSourceMatches()) {
    console.log('nanobot source changed; refreshing the installed desktop wheel...');
    installNanobot({ includeDependencies: false });
    writeSourceMarker();
  } else {
    console.log(`Python and nanobot already present for ${key}, skipping preparation.`);
  }
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

  // Install only the desktop gateway dependency profile and precompile the
  // nanobot package so packaged apps don't re-parse its modules on every cold
  // start (especially expensive under Windows Defender).
  console.log(`Installing nanobot [desktop] dependencies from ${nanobotSrc}...`);
  installNanobot({ includeDependencies: true });
  pruneRuntime(destDir);
  writeRuntimeMarker();
  writeSourceMarker();
  console.log('Done! Standalone Python is ready and configured.');
} catch (err) {
  console.error('Failed to configure standalone Python:', err);
  process.exit(1);
}
