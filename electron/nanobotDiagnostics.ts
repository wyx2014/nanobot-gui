const DEFAULT_MAX_LINES = 500;
const DEFAULT_MAX_CHARACTERS = 120_000;
const MAX_LINE_LENGTH = 12_000;

export type NanobotDiagnosticSource = 'bridge' | 'stdout' | 'stderr';

interface NanobotDiagnosticEntry {
  timestamp: string;
  source: NanobotDiagnosticSource;
  message: string;
}

/**
 * Redact common credential shapes before diagnostics cross the IPC boundary.
 * The diagnostic panel may still contain local paths, which is intentional and
 * called out in the UI because those paths are useful when debugging packaged
 * runtimes.
 */
export function redactNanobotDiagnosticText(
  value: string,
  exactSecrets: ReadonlyArray<string> = [],
): string {
  let redacted = value;

  for (const secret of exactSecrets) {
    if (!secret || secret.length < 4) continue;
    redacted = redacted.split(secret).join('[REDACTED]');
  }

  redacted = redacted
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/-]{12,}/gi, '$1[REDACTED]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token(?:[_-]?issue[_-]?secret)?|secret|password)\s*["']?\s*[:=]\s*["']?)([^\s,"'}\]]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]');

  return redacted;
}

/** A process-lifetime, bounded buffer that records startup output even closed. */
export class NanobotDiagnosticBuffer {
  private entries: NanobotDiagnosticEntry[] = [];
  private characterCount = 0;

  constructor(
    private readonly maxLines = DEFAULT_MAX_LINES,
    private readonly maxCharacters = DEFAULT_MAX_CHARACTERS,
  ) {}

  append(
    source: NanobotDiagnosticSource,
    value: unknown,
    capturedAt = new Date(),
  ): void {
    const normalized = String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replaceAll('\0', '');
    const lines = normalized.split('\n');
    while (lines.length > 1 && lines.at(-1) === '') lines.pop();

    for (const rawLine of lines) {
      const message = rawLine.length > MAX_LINE_LENGTH
        ? `${rawLine.slice(0, MAX_LINE_LENGTH)}… [truncated]`
        : rawLine;
      const entry: NanobotDiagnosticEntry = {
        timestamp: capturedAt.toISOString(),
        source,
        message,
      };
      this.entries.push(entry);
      this.characterCount += message.length;
    }

    while (
      this.entries.length > this.maxLines
      || (this.characterCount > this.maxCharacters && this.entries.length > 1)
    ) {
      const removed = this.entries.shift();
      this.characterCount -= removed?.message.length ?? 0;
    }
  }

  format(exactSecrets: ReadonlyArray<string> = []): string {
    const output = this.entries
      .map((entry) => `[${entry.timestamp}] [${entry.source}] ${entry.message}`)
      .join('\n');
    return redactNanobotDiagnosticText(output, exactSecrets);
  }
}
