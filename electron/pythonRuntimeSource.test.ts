import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  canonicalFileSha256,
  nanobotSourceSha256,
} from '../scripts/python-runtime-source.mjs';

const temporaryDirectories: string[] = [];

function createNanobotFixture(lineEnding: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tpacowork-runtime-source-'));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, 'nanobot'));
  fs.writeFileSync(
    path.join(root, 'nanobot', 'agent.py'),
    `def run():${lineEnding}    return 'ok'${lineEnding}`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'nanobot', 'report.html'),
    `<main>${lineEnding}report${lineEnding}</main>${lineEnding}`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'pyproject.toml'),
    `[project]${lineEnding}name = "nanobot"${lineEnding}`,
    'utf8',
  );
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Python runtime source digest', () => {
  it('normalizes Windows and Unix line endings', () => {
    const unixRoot = createNanobotFixture('\n');
    const windowsRoot = createNanobotFixture('\r\n');

    expect(canonicalFileSha256(path.join(unixRoot, 'pyproject.toml')))
      .toBe(canonicalFileSha256(path.join(windowsRoot, 'pyproject.toml')));
    expect(nanobotSourceSha256(unixRoot)).toBe(nanobotSourceSha256(windowsRoot));
  });

  it('includes non-Python package assets in the source contract', () => {
    const root = createNanobotFixture('\n');
    const originalDigest = nanobotSourceSha256(root);
    fs.writeFileSync(path.join(root, 'nanobot', 'report.html'), '<main>changed</main>\n');

    expect(nanobotSourceSha256(root)).not.toBe(originalDigest);
  });
});
