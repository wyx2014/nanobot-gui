import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  PYTHON_STANDALONE_RELEASE,
  PYTHON_VERSION,
  RUNTIME_PROFILE,
  WINDOWS_RUNTIME_TARGET,
  runtimeAssetMetadata,
} from './python-runtime-config.mjs';
import {
  canonicalFileSha256,
  fileSha256,
  nanobotSourceSha256,
} from './python-runtime-source.mjs';
import { precompileDesktopStartupModules } from './python-runtime-startup-cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const nanobotSourceDir = path.resolve(repoRoot, '..', 'nanobot');
const nanobotPyproject = path.join(nanobotSourceDir, 'pyproject.toml');

function optionValue(name) {
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex >= 0) return process.argv[exactIndex + 1];
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : undefined;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

const target = optionValue('--target') || WINDOWS_RUNTIME_TARGET;
const runtimeDir = path.resolve(optionValue('--runtime-dir') || path.join(repoRoot, 'embedded-python', 'runtime'));
const outputDir = path.resolve(optionValue('--output-dir') || path.join(repoRoot, 'dist', 'python-runtime'));
const metadata = runtimeAssetMetadata(target);
const marker = readJson(path.join(runtimeDir, '.tpacowork-runtime.json'));
const sourceDigestPath = path.join(runtimeDir, '.tpacowork-nanobot-source.sha256');
const pythonBin = target.startsWith('win32-')
  ? path.join(runtimeDir, 'python.exe')
  : path.join(runtimeDir, 'bin', 'python3');
const installedNanobotDir = target.startsWith('win32-')
  ? path.join(runtimeDir, 'Lib', 'site-packages', 'nanobot')
  : path.join(runtimeDir, 'lib', `python${PYTHON_VERSION.split('.').slice(0, 2).join('.')}`, 'site-packages', 'nanobot');

const errors = [];
for (const [name, expected] of Object.entries({
  target,
  pythonVersion: PYTHON_VERSION,
  releaseTag: PYTHON_STANDALONE_RELEASE,
  profile: RUNTIME_PROFILE,
})) {
  if (marker?.[name] !== expected) errors.push(`runtime marker ${name} must equal ${expected}`);
}
if (!/^[a-f0-9]{64}$/i.test(marker?.dependencySpecSha256 || '')) {
  errors.push('runtime marker is missing dependencySpecSha256');
} else if (!fs.existsSync(nanobotPyproject)) {
  errors.push(`nanobot source is required at ${nanobotSourceDir}`);
} else if (marker.dependencySpecSha256 !== canonicalFileSha256(nanobotPyproject)) {
  errors.push('runtime dependency digest does not match the checked-out nanobot source');
}
if (!fs.existsSync(pythonBin)) errors.push(`missing target interpreter: ${pythonBin}`);
if (!fs.existsSync(installedNanobotDir)) errors.push(`missing installed nanobot: ${installedNanobotDir}`);
let runtimeNanobotSourceSha256 = '';
try {
  runtimeNanobotSourceSha256 = fs.readFileSync(sourceDigestPath, 'utf8').trim();
} catch {
  // Reported below.
}
if (!/^[a-f0-9]{64}$/i.test(runtimeNanobotSourceSha256)) {
  errors.push('runtime is missing a valid nanobot source digest');
} else if (fs.existsSync(nanobotPyproject)
  && runtimeNanobotSourceSha256 !== nanobotSourceSha256ForCheckout()) {
  errors.push('runtime nanobot source digest does not match the checked-out source');
}
if (errors.length > 0) {
  console.error(`Cannot package ${target} Python runtime:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

if (`${process.platform}-${process.arch}` !== target) {
  console.error(`Runtime archives must be produced on their target host (${target}).`);
  process.exit(1);
}

function nanobotSourceSha256ForCheckout() {
  return nanobotSourceSha256(nanobotSourceDir);
}

precompileDesktopStartupModules(pythonBin);

execFileSync(
  pythonBin,
  [
    '-c',
    [
      'import nanobot, platform, sys',
      `assert sys.version_info[:3] == (${PYTHON_VERSION.split('.').join(', ')}), sys.version`,
      "assert platform.machine().lower() in {'amd64', 'x86_64'}, platform.machine()",
      'from nanobot.cli.commands import app',
      'print(nanobot.__file__)',
      'print(sys.version)',
      'print(platform.machine())',
      'print(type(app).__name__)',
    ].join('; '),
  ],
  { stdio: 'inherit' },
);

fs.mkdirSync(outputDir, { recursive: true });
const archivePath = path.join(outputDir, metadata.archive);
const checksumPath = path.join(outputDir, metadata.checksum);
const manifestPath = path.join(outputDir, metadata.manifest);
fs.rmSync(archivePath, { force: true });
fs.rmSync(checksumPath, { force: true });
fs.rmSync(manifestPath, { force: true });

execFileSync(
  'tar',
  ['-a', '-c', '-f', archivePath, '-C', runtimeDir, '.'],
  { stdio: 'inherit' },
);
const archiveSha256 = await fileSha256(archivePath);
fs.writeFileSync(checksumPath, `${archiveSha256}  ${metadata.archive}\n`, 'utf8');
fs.writeFileSync(manifestPath, `${JSON.stringify({
  ...metadata,
  dependencySpecSha256: marker.dependencySpecSha256,
  nanobotSourceSha256: runtimeNanobotSourceSha256,
  archiveSha256,
  size: fs.statSync(archivePath).size,
}, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  archivePath,
  checksumPath,
  manifestPath,
  releaseTag: metadata.releaseTag,
  archiveSha256,
}, null, 2));
