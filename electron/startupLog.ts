import fs from 'node:fs';
import path from 'node:path';
import { redactNanobotDiagnosticText, type NanobotDiagnosticSource } from './nanobotDiagnostics';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/** Persistent, launch-spanning log for diagnosing packaged cold starts. */
export class StartupLog {
  private initialized = false;

  constructor(
    readonly filePath: string,
    private readonly maxBytes = DEFAULT_MAX_BYTES,
  ) {}

  append(
    source: NanobotDiagnosticSource,
    value: unknown,
    exactSecrets: ReadonlyArray<string> = [],
    capturedAt = new Date(),
  ): void {
    try {
      this.initialize(capturedAt);
      const normalized = String(value ?? '')
        .replace(/\r\n?/g, '\n')
        .replaceAll('\0', '');
      const output = normalized
        .split('\n')
        .map((line) => `[${capturedAt.toISOString()}] [${source}] ${line}`)
        .join('\n');
      fs.appendFileSync(
        this.filePath,
        `${redactNanobotDiagnosticText(output, exactSecrets)}\n`,
        'utf8',
      );
    } catch {
      // Diagnostics must never become another startup failure mode.
    }
  }

  private initialize(capturedAt: Date): void {
    if (this.initialized) return;
    this.initialized = true;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    try {
      if (fs.statSync(this.filePath).size > this.maxBytes) {
        const previousPath = `${this.filePath}.previous`;
        fs.rmSync(previousPath, { force: true });
        fs.renameSync(this.filePath, previousPath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    fs.appendFileSync(
      this.filePath,
      `\n=== TPACowork launch ${capturedAt.toISOString()} pid=${process.pid} ===\n`,
      'utf8',
    );
  }
}
