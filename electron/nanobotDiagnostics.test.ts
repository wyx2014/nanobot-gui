import { describe, expect, it } from 'vitest';
import {
  NanobotDiagnosticBuffer,
  redactNanobotDiagnosticText,
} from './nanobotDiagnostics';

describe('nanobot diagnostics', () => {
  it('redacts exact bootstrap secrets and common credential formats', () => {
    const output = redactNanobotDiagnosticText([
      'tokenSecret=desktop-secret-value',
      'Authorization: Bearer bearer-secret-value',
      'api_key: sk-example1234567890',
      'url=https://example.test/path?token=query-secret-value&mode=1',
    ].join('\n'), ['desktop-secret-value']);

    expect(output).not.toContain('desktop-secret-value');
    expect(output).not.toContain('bearer-secret-value');
    expect(output).not.toContain('sk-example1234567890');
    expect(output).not.toContain('query-secret-value');
    expect(output).toContain('[REDACTED]');
  });

  it('records continuously into a bounded process-lifetime buffer', () => {
    const buffer = new NanobotDiagnosticBuffer(3, 10_000);
    buffer.append('main', 'starting', new Date('2026-08-13T00:00:00.000Z'));
    buffer.append('stdout', 'line one\nline two', new Date('2026-08-13T00:00:01.000Z'));
    buffer.append('stderr', 'last error', new Date('2026-08-13T00:00:02.000Z'));

    const output = buffer.format();
    expect(output).not.toContain('starting');
    expect(output).toContain('[stdout] line one');
    expect(output).toContain('[stdout] line two');
    expect(output).toContain('[stderr] last error');
  });
});
