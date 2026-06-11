import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_TAG = '20250212';
const PYTHON_VERSION = '3.12.9';

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
const pythonBin = process.platform === 'win32'
  ? path.join(destDir, 'python.exe')
  : path.join(destDir, 'bin', 'python3');

if (fs.existsSync(pythonBin)) {
  console.log(`Python already present for ${key}, skipping download.`);
  process.exit(0);
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

  // Install nanobot dependencies into the standalone Python
  const pip = process.platform === 'win32'
    ? path.join(destDir, 'Scripts', 'pip.exe')
    : path.join(destDir, 'bin', 'pip3');
  
  const nanobotSrc = path.resolve(__dirname, '..', '..', 'nanobot');
  console.log(`Installing nanobot [api] dependencies from ${nanobotSrc}...`);
  execSync(`"${pip}" install --quiet "${nanobotSrc}[api]"`, { stdio: 'inherit' });
  console.log('Done! Standalone Python is ready and configured.');
} catch (err) {
  console.error('Failed to configure standalone Python:', err);
  process.exit(1);
}
