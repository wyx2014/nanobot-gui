import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StartupLog } from './startupLog';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('startup log', () => {
  it('keeps launch timing lines on disk and redacts secrets', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tpcowork-startup-log-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'startup.log');
    const log = new StartupLog(filePath);

    log.append('main', 'window-ready token=desktop-secret', ['desktop-secret'], new Date('2026-08-17T00:00:00Z'));
    log.append('bridge', 'python-spawned', [], new Date('2026-08-17T00:00:01Z'));

    const output = fs.readFileSync(filePath, 'utf8');
    expect(output).toContain('=== TPCowork launch 2026-08-17T00:00:00.000Z');
    expect(output).toContain('[main] window-ready token=[REDACTED]');
    expect(output).toContain('[bridge] python-spawned');
    expect(output).not.toContain('desktop-secret');
  });
});
