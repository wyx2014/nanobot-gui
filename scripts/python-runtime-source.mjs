import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { TextDecoder } from 'util';

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const ignoredDirectories = new Set([
  '.git',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.venv',
  '__pycache__',
  'build',
  'dist',
  'tests',
  'venv',
]);
const ignoredFiles = new Set(['.DS_Store']);
const ignoredExtensions = new Set(['.pyc', '.pyo']);

export function canonicalFileContents(filePath) {
  const contents = fs.readFileSync(filePath);
  try {
    const text = utf8Decoder.decode(contents);
    return Buffer.from(text.replaceAll('\r\n', '\n'), 'utf8');
  } catch {
    return contents;
  }
}

export function canonicalFileSha256(filePath) {
  return createHash('sha256')
    .update(canonicalFileContents(filePath))
    .digest('hex');
}

export async function fileSha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export function nanobotSourceSha256(nanobotSourceDir) {
  const hash = createHash('sha256');

  const visit = (entryPath, relativePath = '') => {
    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(entryPath).sort()) {
        if (ignoredDirectories.has(name)) continue;
        visit(path.join(entryPath, name), path.join(relativePath, name));
      }
      return;
    }
    if (!stat.isFile()) return;
    if (ignoredFiles.has(path.basename(entryPath))) return;
    if (ignoredExtensions.has(path.extname(entryPath).toLowerCase())) return;

    hash.update(relativePath.replaceAll(path.sep, '/'));
    hash.update('\0');
    hash.update(canonicalFileContents(entryPath));
    hash.update('\0');
  };

  visit(path.join(nanobotSourceDir, 'nanobot'), 'nanobot');
  for (const name of ['pyproject.toml', 'hatch_build.py']) {
    const entryPath = path.join(nanobotSourceDir, name);
    if (fs.existsSync(entryPath)) visit(entryPath, name);
  }
  return hash.digest('hex');
}
