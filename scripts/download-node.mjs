import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const version = '22.22.1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetIndex = process.argv.indexOf('--target');
const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : `${process.platform}-${process.arch}`;
const targets = { 'win32-x64': 'win-x64', 'darwin-arm64': 'darwin-arm64', 'darwin-x64': 'darwin-x64', 'linux-x64': 'linux-x64' };
if (!targets[target]) throw new Error(`Unsupported Node target: ${target}`);
const windows = target.startsWith('win32-');
const distribution = `node-v${version}-${targets[target]}`;
const archive = `${distribution}.${windows ? 'zip' : 'tar.gz'}`;
const url = `https://nodejs.org/dist/v${version}/`;
const destination = path.join(root, 'embedded-node', 'runtime');
const relativeNode = windows ? 'node.exe' : 'bin/node';
const relativeNpm = windows ? 'npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js';
const relativeNpxCli = windows ? 'npm/bin/npx-cli.js' : 'lib/node_modules/npm/bin/npx-cli.js';
const relativeNpx = windows ? 'npx.cmd' : 'bin/npx';

if (process.argv.includes('--print-config')) {
  console.log(JSON.stringify({ version, target, archive, url: url + archive, node: relativeNode, npm: relativeNpm, npx: relativeNpx }));
  process.exit(0);
}

async function usable(directory) {
  try {
    const marker = JSON.parse(await fs.readFile(path.join(directory, '.tpcowork-node.json'), 'utf8'));
    if (marker.version !== version || marker.target !== target) return false;
    if (windows && marker.layout !== 'portable-npm-v1') return false;
    await Promise.all([relativeNode, relativeNpm, relativeNpxCli, relativeNpx].map(name => fs.access(path.join(directory, name))));
    if (windows) {
      const npmLauncher = await fs.readFile(path.join(directory, 'npm.cmd'), 'utf8');
      const npxLauncher = await fs.readFile(path.join(directory, 'npx.cmd'), 'utf8');
      if (!npmLauncher.includes('%~dp0\\npm\\bin\\npm-cli.js')
          || !npxLauncher.includes('%~dp0\\npm\\bin\\npx-cli.js')) return false;
    }
    if (target === `${process.platform}-${process.arch}`) {
      const binary = path.join(directory, relativeNode);
      if (execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim() !== `v${version}`) return false;
      execFileSync(binary, [path.join(directory, relativeNpm), '--version'], { stdio: 'pipe' });
      execFileSync(binary, [path.join(directory, relativeNpxCli), '--version'], { stdio: 'pipe' });
    }
    return true;
  } catch { return false; }
}

async function makeWindowsNpmPortable(directory) {
  if (!windows) return;
  await fs.rename(path.join(directory, 'node_modules', 'npm'), path.join(directory, 'npm'));
  for (const name of ['npm', 'npm.cmd', 'npm.ps1', 'npx', 'npx.cmd', 'npx.ps1']) {
    const launcher = path.join(directory, name);
    const contents = await fs.readFile(launcher, 'utf8');
    const rewritten = contents
      .replaceAll('$CLI_BASEDIR/node_modules/npm', '$CLI_BASEDIR/npm')
      .replaceAll('%~dp0\\node_modules\\npm', '%~dp0\\npm')
      .replaceAll('$PSScriptRoot/node_modules/npm', '$PSScriptRoot/npm');
    if (rewritten === contents) throw new Error(`Unable to rewrite bundled ${name} launcher`);
    await fs.writeFile(launcher, rewritten);
  }
}

async function download(file) {
  const response = await fetch(url + file, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url + file}`);
  return Buffer.from(await response.arrayBuffer());
}

if (await usable(destination)) {
  console.log(`Node ${version} and npm are ready for ${target}.`);
} else {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const staging = await fs.mkdtemp(path.join(path.dirname(destination), '.prepare-'));
  try {
    const sums = (await download('SHASUMS256.txt')).toString('utf8');
    const expected = sums.split('\n').map(line => line.trim().split(/\s+/)).find(([, name]) => name === archive)?.[0];
    if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Missing checksum for ${archive}`);
    console.log(`Downloading bundled Node/npm for ${target}...`);
    const data = await download(archive);
    if (crypto.createHash('sha256').update(data).digest('hex') !== expected) throw new Error('Node archive checksum mismatch');
    const archivePath = path.join(staging, archive);
    await fs.writeFile(archivePath, data);
    execFileSync('tar', ['-xf', archivePath, '-C', staging], { stdio: 'inherit' });
    const extracted = path.join(staging, distribution);
    await makeWindowsNpmPortable(extracted);
    await fs.writeFile(path.join(extracted, '.tpcowork-node.json'), JSON.stringify({
      version,
      target,
      sha256: expected,
      ...(windows ? { layout: 'portable-npm-v1' } : {}),
    }));
    if (!await usable(extracted)) throw new Error('Bundled Node/npm validation failed');
    // Preserve an existing generated runtime until the replacement is validated.
    try { await fs.rename(destination, `${destination}.previous-${Date.now()}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(extracted, destination);
    console.log(`Bundled Node ${version} and npm prepared at ${destination}.`);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
