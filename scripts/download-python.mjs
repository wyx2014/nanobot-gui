import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';

import {
  PYTHON_STANDALONE_RELEASE,
  PYTHON_VERSION,
  RUNTIME_PROFILE,
  RUNTIME_TARGETS,
  runtimeAssetMetadata,
} from './python-runtime-config.mjs';
import {
  canonicalFileSha256,
  nanobotSourceSha256,
} from './python-runtime-source.mjs';
import { precompileDesktopStartupModules } from './python-runtime-startup-cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const embeddedPythonDir = path.join(repoRoot, 'embedded-python');
const destDir = path.join(embeddedPythonDir, 'runtime');
const hostKey = `${process.platform}-${process.arch}`;
const RUNTIME_MARKER_NAME = '.tpcowork-runtime.json';
const PREVIOUS_RUNTIME_MARKER_NAME = '.tpacowork-runtime.json';
const SOURCE_MARKER_NAME = '.tpcowork-nanobot-source.sha256';
const PREVIOUS_SOURCE_MARKER_NAME = '.tpacowork-nanobot-source.sha256';

function optionValue(name) {
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex >= 0) return process.argv[exactIndex + 1];
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : undefined;
}

const targetKey = optionValue('--target') || hostKey;
const tarball = RUNTIME_TARGETS[targetKey];
if (!tarball) {
  console.error(`Unsupported Python runtime target: ${targetKey}`);
  process.exit(1);
}

const assetMetadata = runtimeAssetMetadata(targetKey);

if (process.argv.includes('--print-config')) {
  console.log(JSON.stringify({
    ...assetMetadata,
    host: hostKey,
    mode: targetKey === hostKey ? 'build-on-host' : 'target-host-required',
  }, null, 2));
  process.exit(0);
}

if (targetKey !== hostKey) {
  console.error(
    `target-host-required: ${targetKey} runtime must be prepared on its target host; `
    + `current host is ${hostKey}.`,
  );
  process.exit(1);
}

const nanobotSrc = path.resolve(repoRoot, '..', 'nanobot');
const nanobotPyproject = path.join(nanobotSrc, 'pyproject.toml');
if (!fs.existsSync(nanobotPyproject)) {
  console.error(`nanobot source is required at ${nanobotSrc}`);
  process.exit(1);
}

const dependencySpecSha256 = canonicalFileSha256(nanobotPyproject);
const runtimeMarkerPath = path.join(destDir, RUNTIME_MARKER_NAME);
const sourceMarkerPath = path.join(destDir, SOURCE_MARKER_NAME);
const expectedRuntimeMarker = {
  target: targetKey,
  pythonVersion: PYTHON_VERSION,
  releaseTag: PYTHON_STANDALONE_RELEASE,
  profile: RUNTIME_PROFILE,
  dependencySpecSha256,
};
const windowsTarget = targetKey.startsWith('win32-');
const pythonBin = windowsTarget
  ? path.join(destDir, 'python.exe')
  : path.join(destDir, 'bin', 'python3');
const pythonMajorMinor = PYTHON_VERSION.split('.').slice(0, 2).join('.');
const installedNanobotDir = windowsTarget
  ? path.join(destDir, 'Lib', 'site-packages', 'nanobot')
  : path.join(destDir, 'lib', `python${pythonMajorMinor}`, 'site-packages', 'nanobot');

const expectedSourceDigest = nanobotSourceSha256(nanobotSrc);

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readRuntimeMarker(rootDir) {
  return readJson(path.join(rootDir, RUNTIME_MARKER_NAME))
    || readJson(path.join(rootDir, PREVIOUS_RUNTIME_MARKER_NAME));
}

function readSourceMarker(rootDir) {
  for (const markerName of [SOURCE_MARKER_NAME, PREVIOUS_SOURCE_MARKER_NAME]) {
    try {
      const digest = fs.readFileSync(path.join(rootDir, markerName), 'utf8').trim();
      if (digest) return digest;
    } catch {
      // Continue with the previous brand's marker during upgrades.
    }
  }
  return '';
}

function markerMatches(marker) {
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

function installedSourceMatches(rootDir = destDir) {
  return readSourceMarker(rootDir) === expectedSourceDigest;
}

function writeSourceMarker() {
  fs.writeFileSync(sourceMarkerPath, `${expectedSourceDigest}\n`, 'utf8');
}

function runtimePaths(rootDir) {
  const isWindows = targetKey.startsWith('win32-');
  return {
    python: isWindows
      ? path.join(rootDir, 'python.exe')
      : path.join(rootDir, 'bin', 'python3'),
    nanobot: isWindows
      ? path.join(rootDir, 'Lib', 'site-packages', 'nanobot')
      : path.join(rootDir, 'lib', `python${pythonMajorMinor}`, 'site-packages', 'nanobot'),
  };
}

function runtimeValidationErrors(rootDir) {
  const errors = [];
  const marker = readRuntimeMarker(rootDir);
  if (!markerMatches(marker)) {
    errors.push(`runtime marker does not match ${targetKey} / Python ${PYTHON_VERSION}`);
  }
  const paths = runtimePaths(rootDir);
  if (!fs.existsSync(paths.python)) errors.push(`missing target interpreter: ${paths.python}`);
  if (targetKey.startsWith('linux-')
    && fs.existsSync(paths.python)
    && (fs.statSync(paths.python).mode & 0o111) === 0) {
    errors.push(`target interpreter is not executable: ${paths.python}`);
  }
  if (!fs.existsSync(paths.nanobot)) errors.push(`missing installed nanobot package: ${paths.nanobot}`);
  if (!installedSourceMatches(rootDir)) {
    errors.push('nanobot source digest does not match the local sibling repository');
  }
  return errors;
}

function installNanobot({ includeDependencies }) {
  const args = ['install', '--quiet', '--no-compile', '--no-cache-dir'];
  if (!includeDependencies) args.push('--no-deps', '--force-reinstall');
  args.push(includeDependencies ? `${nanobotSrc}[desktop]` : nanobotSrc);
  // TPCowork launches `nanobot desktop-gateway`, which deliberately does not
  // serve nanobot's browser WebUI (`webui_static_dist=False`). Skipping that
  // unrelated Hatch hook also avoids invoking npm/npm.cmd while assembling a
  // relocatable Windows runtime.
  execFileSync(pythonBin, ['-m', 'pip', ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NANOBOT_SKIP_WEBUI_BUILD: '1',
    },
  });
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
  precompileDesktopStartupModules(pythonBin);
}

function pruneRuntime(rootDir) {
  const pruneDirNames = new Set(['test', 'tests']);
  let removedDirs = 0;

  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      if (pruneDirNames.has(entry.name)) {
        fs.rmSync(entryPath, { recursive: true, force: true });
        removedDirs += 1;
      } else {
        visit(entryPath);
      }
    }
  };

  visit(rootDir);
  console.log(`Pruned Python runtime: removed ${removedDirs} test directories; retained bytecode caches.`);
}

async function downloadFile(url, destination, extraHeaders = {}) {
  const headers = {
    'User-Agent': 'TPCowork-runtime-preparer',
    ...extraHeaders,
  };
  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  await pipeline(
    Readable.fromWeb(response.body),
    fs.createWriteStream(destination),
  );
}

async function buildRuntimeOnHost() {
  if (targetKey !== hostKey) {
    throw new Error(`Cannot execute ${targetKey} Python on host ${hostKey}.`);
  }

  const currentMarker = readRuntimeMarker(destDir);
  if (fs.existsSync(pythonBin) && markerMatches(currentMarker)) {
    if (!fs.existsSync(installedNanobotDir)) {
      console.log('nanobot is missing from the cached runtime; installing desktop dependencies...');
      installNanobot({ includeDependencies: true });
      writeSourceMarker();
    } else if (!installedSourceMatches()) {
      console.log('nanobot source changed; refreshing the installed desktop wheel...');
      installNanobot({ includeDependencies: false });
      writeSourceMarker();
    } else {
      console.log(`Python and nanobot already present for ${targetKey}, skipping preparation.`);
      precompileDesktopStartupModules(pythonBin);
    }
    writeRuntimeMarker();
    pruneRuntime(destDir);
    return;
  }

  if (fs.existsSync(destDir)) {
    console.log(`Python runtime cache is stale for ${targetKey}; rebuilding ${RUNTIME_PROFILE}.`);
    fs.rmSync(destDir, { recursive: true, force: true });
  }

  const baseUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_STANDALONE_RELEASE}`;
  const url = `${baseUrl}/${tarball.replace('+', '%2B')}`;
  const tmpTarball = path.join(embeddedPythonDir, `.${targetKey}-python-runtime.tar.gz`);
  fs.mkdirSync(destDir, { recursive: true });

  try {
    console.log(`Downloading ${url}`);
    await downloadFile(url, tmpTarball);
    execFileSync(
      'tar',
      ['-xf', tmpTarball, '-C', destDir, '--strip-components=1'],
      { stdio: 'inherit' },
    );
    fs.rmSync(tmpTarball, { force: true });
    console.log(`Installing nanobot [desktop] dependencies from ${nanobotSrc}...`);
    installNanobot({ includeDependencies: true });
    pruneRuntime(destDir);
    writeRuntimeMarker();
    writeSourceMarker();
    const validationErrors = runtimeValidationErrors(destDir);
    if (validationErrors.length > 0) {
      throw new Error(`Prepared runtime failed validation:\n- ${validationErrors.join('\n- ')}`);
    }
    console.log(`Standalone Python ${PYTHON_VERSION} is ready for ${targetKey}.`);
  } catch (error) {
    fs.rmSync(tmpTarball, { force: true });
    throw error;
  }
}

try {
  await buildRuntimeOnHost();
} catch (error) {
  console.error(`Failed to prepare Python runtime for ${targetKey}:`, error);
  process.exit(1);
}
