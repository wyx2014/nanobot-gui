import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartupLog } from './startupLog';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function logPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tpcowork-startup-log-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'startup.log');
}

function archives(filePath: string): string[] {
  return fs.readdirSync(path.dirname(filePath))
    .filter((name) => name.startsWith('startup.') && name !== 'startup.log')
    .map((name) => path.join(path.dirname(filePath), name));
}

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

  it('archives the previous local day while the app stays open', () => {
    const filePath = logPath();
    const log = new StartupLog(filePath);
    log.append('main', 'yesterday', [], new Date(2026, 8, 5, 23, 59, 59));
    log.append('bridge', 'today', [], new Date(2026, 8, 6, 0, 0, 0));
    log.append('bridge', 'still today', [], new Date(2026, 8, 6, 0, 0, 1));

    const previous = archives(filePath);
    expect(previous).toHaveLength(1);
    expect(path.basename(previous[0])).toBe('startup.2026-09-05_23-59-59_000.log');
    expect(fs.readFileSync(previous[0], 'utf8')).toContain('yesterday');
    expect(fs.readFileSync(filePath, 'utf8')).not.toContain('yesterday');
    expect(fs.readFileSync(filePath, 'utf8')).toContain('still today');
  });

  it('checks the byte limit on every write and preserves same-timestamp archives', () => {
    const filePath = logPath();
    const log = new StartupLog(filePath, 200);
    const now = new Date();
    for (const message of ['first', 'second', 'third']) {
      log.append('bridge', `${message} ${'\u4e2d'.repeat(40)}`, [], now);
    }

    const previous = archives(filePath);
    expect(previous).toHaveLength(2);
    const history = previous.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(history).toContain('first');
    expect(history).toContain('second');
    expect(fs.readFileSync(filePath, 'utf8')).toContain('third');
  });

  it.each(['old day', 'oversized'])('rotates an existing %s log after restart', (reason) => {
    const filePath = logPath();
    const now = new Date();
    const previous = reason === 'oversized' ? 'x'.repeat(500) : 'previous launch';
    fs.writeFileSync(filePath, previous);
    const modified = new Date(now.getTime() - (reason === 'old day' ? 86400000 : 0));
    fs.utimesSync(filePath, modified, modified);

    new StartupLog(filePath, 400).append('main', 'new launch', [], now);

    expect(archives(filePath)).toHaveLength(1);
    expect(fs.readFileSync(archives(filePath)[0], 'utf8')).toBe(previous);
    expect(fs.readFileSync(filePath, 'utf8')).toContain('new launch');
  });

  it('preserves multiple launches on the same day in the current log', () => {
    const filePath = logPath();
    new StartupLog(filePath).append('main', 'first launch');
    new StartupLog(filePath).append('main', 'second launch');

    expect(archives(filePath)).toEqual([]);
    const output = fs.readFileSync(filePath, 'utf8');
    expect(output).toContain('first launch');
    expect(output).toContain('second launch');
    expect(output.match(/=== TPCowork launch/g)).toHaveLength(2);
  });

  it('cleans expired, excess and legacy archives on launch without touching other files', () => {
    const filePath = logPath();
    const directory = path.dirname(filePath);
    const now = new Date();
    const create = (name: string, ageDays: number) => {
      const archivePath = path.join(directory, name);
      fs.writeFileSync(archivePath, '1234567890');
      const modified = new Date(now.getTime() - ageDays * 86400000);
      fs.utimesSync(archivePath, modified, modified);
      return archivePath;
    };
    const expired = create('startup.2026-08-01_00-00-00_000.log', 366);
    const oldest = create('startup.2026-08-02_00-00-00_000.log', 364);
    const newer = create('startup.2026-08-03_00-00-00_000.log', 180);
    const newest = create('startup.2026-08-04_00-00-00_000.log', 30);
    const legacy = create('startup.log.previous', 400);
    const unrelated = create('startup.manual-backup.log', 400);
    const runtime = create('nanobot.2026-08-01_00-00-00_000.log', 400);

    new StartupLog(filePath, 1024, 20).append('main', 'new launch', [], now);

    expect([expired, oldest, legacy].map((file) => fs.existsSync(file))).toEqual([false, false, false]);
    expect([newer, newest, unrelated, runtime, filePath].every((file) => fs.existsSync(file))).toBe(true);
  });

  it('enforces archive capacity during a long-running launch', () => {
    const filePath = logPath();
    const log = new StartupLog(filePath, 180, 400);
    for (let index = 0; index < 10; index++) {
      log.append('bridge', `${index} ${'x'.repeat(100)}`);
    }

    const previous = archives(filePath);
    expect(previous.length).toBeGreaterThan(0);
    expect(previous.reduce((sum, file) => sum + fs.statSync(file).size, 0)).toBeLessThanOrEqual(400);
    expect(fs.readFileSync(filePath, 'utf8')).toContain('9 ');
  });

  it('retries initialization after a temporary write failure', () => {
    const filePath = logPath();
    const log = new StartupLog(filePath);
    vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => {
      throw new Error('temporarily unavailable');
    });

    expect(() => log.append('main', 'first attempt')).not.toThrow();
    log.append('main', 'second attempt');

    const output = fs.readFileSync(filePath, 'utf8');
    expect(output).toContain('=== TPCowork launch');
    expect(output).toContain('second attempt');
  });
});
