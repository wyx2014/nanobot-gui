import { redactNanobotDiagnosticText } from '../nanobotDiagnostics';

const SECRET_KEY = /(?:password|passwd|secret|api_?key|authorization|cookie|private_key|access_key|credential|token)/i;
const COUNTERS = new Set(['input_tokens', 'output_tokens', 'cached_input_tokens', 'total_tokens', 'token_estimate']);
const OMITTED = new Set(['message', 'messages', 'content', 'body', 'prompt', 'reasoning', 'arguments', 'params',
  'payload', 'stdout', 'stderr', 'output', 'input', 'error_json', 'attributes_json', 'tool_input', 'tool_result']);

/** One instance per bundle: aliases are consistent and their reverse map never leaves memory. */
export class BundleRedactor {
  replacements = 0;
  omitted_fields = 0;
  private aliases = new Map<string, string>();
  constructor(private secrets: string[] = []) {}

  private alias(kind: string, value: string) {
    const key = `${kind}:${value}`;
    if (!this.aliases.has(key)) this.aliases.set(key, `<${kind}-${this.aliases.size + 1}>`);
    return this.aliases.get(key)!;
  }

  text(value: string): string {
    let output = redactNanobotDiagnosticText(value, this.secrets)
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED]')
      .replace(/\b(?:Basic|Bearer)\s+[^\s,;]+/gi, '[REDACTED]')
      .replace(/\b(?:gh[pousr]_|github_pat_|sk[_-])[A-Za-z0-9_-]+/g, '[REDACTED]')
      .replace(/((?:authorization|cookie|set-cookie|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*["']?\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
      .replace(/\b(?:https?|wss?):\/\/[^\s)"'<>]+/gi, (url) => {
        try { return this.alias('url', new URL(url).origin + new URL(url).pathname); }
        catch { return '<url>'; }
      })
      .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|Volumes|tmp|var|private|opt|mnt)\/)[^\r\n"'<>)]*/g, (local) => this.alias('path', local))
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (email) => this.alias('email', email));
    if (output.length > 4000) output = output.slice(0, 4000) + '[TRUNCATED]';
    if (output !== value) this.replacements++;
    return output;
  }

  value(value: unknown, key = '', depth = 0): unknown {
    if (depth > 12) { this.omitted_fields++; return '[DEPTH LIMIT]'; }
    if (SECRET_KEY.test(key) && !COUNTERS.has(key)) { this.omitted_fields++; return '[REDACTED]'; }
    if (OMITTED.has(key)) { this.omitted_fields++; return '[CONTENT OMITTED]'; }
    if (typeof value === 'string') {
      if (['server_id', 'tool_name', 'name'].includes(key)) return this.alias('resource', value);
      return this.text(value);
    }
    if (Array.isArray(value)) return value.map((item) => this.value(item, '', depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, this.value(item, name, depth + 1)]),
    );
    return value;
  }

  /** Legacy logs can contain unlabelled model/tool bodies. Export only recognizable technical facts. */
  legacy(line: string): string | null {
    const timestamp = line.match(/\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?/)?.[0];
    const level = line.match(/\b(?:DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\b/)?.[0];
    const frame = line.match(/File "([^"\r\n]+)", line (\d+), in ([\w<>]+)/);
    const errorType = line.match(/\b([A-Za-z][A-Za-z0-9_.]*(?:Error|Exception))\b/)?.[1];
    const stage = line.match(/\b(?:gateway-[a-z-]+|runtime-[a-z-]+|renderer-[a-z-]+)\b/)?.[0];
    const code = line.match(/\b(?:ENOENT|EACCES|ENOSPC|ECONNREFUSED|ETIMEDOUT|SQLITE_BUSY)\b/)?.[0];
    if (!timestamp && !frame && !errorType && !code) return null;
    this.omitted_fields++;
    return [timestamp, level, stage, code, errorType,
      frame ? `${this.alias('path', frame[1])}:${frame[2]} in ${frame[3]}` : null, '[message omitted]'].filter(Boolean).join(' ');
  }
}
