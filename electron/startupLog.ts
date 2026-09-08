import fs from 'node:fs';
import path from 'node:path';
import { redactNanobotDiagnosticText, type NanobotDiagnosticSource } from './nanobotDiagnostics';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

function localDay(value: Date): string {
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-');
}

function archiveTimestamp(value: Date): string {
  const time = [value.getHours(), value.getMinutes(), value.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
  return `${localDay(value)}_${time}_${String(value.getMilliseconds()).padStart(3, '0')}`;
}

/** Persistent, launch-spanning log for diagnosing packaged cold starts. */
export class StartupLog {
  private initialized = false;
  private lastWrittenAt: Date | null = null;

  constructor(
    readonly filePath: string,
    private readonly maxBytes = DEFAULT_MAX_BYTES,
    private readonly maxArchiveBytes = DEFAULT_MAX_ARCHIVE_BYTES,
  ) {}

  append(
    source: NanobotDiagnosticSource,
    value: unknown,
    exactSecrets: ReadonlyArray<string> = [],
    capturedAt = new Date(),
  ): void {
    try {
      const normalized = String(value ?? '')
        .replace(/\r\n?/g, '\n')
        .replaceAll('\0', '');
      const output = normalized
        .split('\n')
        .map((line) => `[${capturedAt.toISOString()}] [${source}] ${line}`)
        .join('\n');
      const header = this.initialized
        ? ''
        : `\n=== TPCowork launch ${capturedAt.toISOString()} pid=${process.pid} ===\n`;
      const entry = `${header}${redactNanobotDiagnosticText(output, exactSecrets)}\n`;
      if (!this.initialized) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        this.cleanup(capturedAt);
      }
      this.rotateIfNeeded(Buffer.byteLength(entry, 'utf8'), capturedAt);
      fs.appendFileSync(this.filePath, entry, 'utf8');
      this.initialized = true;
      this.lastWrittenAt = capturedAt;
    } catch {
      // Diagnostics must never become another startup failure mode.
    }
  }

  private rotateIfNeeded(incomingBytes: number, capturedAt: Date): void {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return;
    }
    const previousDate = this.lastWrittenAt ?? stat.mtime;
    if (stat.size === 0 || (
      stat.size + incomingBytes <= this.maxBytes
      && localDay(previousDate) === localDay(capturedAt)
    )) return;

    const { dir, name, ext } = path.parse(this.filePath);
    const archiveBase = path.join(dir, `${name}.${archiveTimestamp(previousDate)}`);
    let archivePath = `${archiveBase}${ext}`;
    let counter = 1;
    while (fs.existsSync(archivePath)) {
      archivePath = `${archiveBase}.${counter++}${ext}`;
    }
    fs.renameSync(this.filePath, archivePath);
    this.cleanup(capturedAt);
  }

  private cleanup(capturedAt: Date): void {
    try {
      const { dir, name, ext, base } = path.parse(this.filePath);
      const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const archiveName = new RegExp(
        `^${escape(name)}\\.\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}_\\d{3}(?:\\.\\d+)?${escape(ext)}$`,
      );
      const archives: Array<{ filePath: string; modified: number; size: number }> = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || (!archiveName.test(entry.name) && entry.name !== `${base}.previous`)) continue;
        try {
          const filePath = path.join(dir, entry.name);
          const stat = fs.statSync(filePath);
          archives.push({ filePath, modified: stat.mtimeMs, size: stat.size });
        } catch {
          // A previously listed archive may already have been removed.
        }
      }
      archives.sort((a, b) => b.modified - a.modified || b.filePath.localeCompare(a.filePath));
      let retainedBytes = 0;
      for (const archive of archives) {
        if (archive.modified < capturedAt.getTime() - RETENTION_MS
          || retainedBytes + archive.size > this.maxArchiveBytes) {
          try {
            fs.unlinkSync(archive.filePath);
          } catch {
            retainedBytes += archive.size;
          }
        } else {
          retainedBytes += archive.size;
        }
      }
    } catch {
      // Retention failure must not interrupt current diagnostics.
    }
  }
}
