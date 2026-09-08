/** Technical error facts only; exception messages and response bodies never cross this boundary. */
export function diagnosticSymbol(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_.$<>:-]{1,160}$/.test(value) ? value : undefined;
}

export function classifyDiagnosticError(code?: string, status?: number): string {
  const key = (code ?? '').toUpperCase();
  if (/^(ENOTFOUND|EAI_AGAIN|EAI_NONAME)$/.test(key)) return 'network.dns';
  if (/^(CERT_|ERR_TLS_|DEPTH_ZERO_|UNABLE_TO_VERIFY_|SELF_SIGNED_)/.test(key) || /^(SSLERROR|SSLCERTVERIFICATIONERROR)$/.test(key)) return 'network.tls';
  if (/^(ETIMEDOUT|UND_ERR_.*TIMEOUT|TIMEOUTERROR|CONNECTTIMEOUT|READTIMEOUT|APITIMEOUTERROR|TIMEOUT)$/.test(key)) return 'network.timeout';
  if (/^(ECONNREFUSED|ECONNRESET|EPIPE|CONNECTERROR|APICONNECTIONERROR)$/.test(key)) return 'network.connection';
  if (/^(PROXYERROR|PROXY_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED)$/.test(key)) return 'network.proxy';
  if (/^(ABORTERROR|CANCELLEDERROR)$/.test(key)) return 'cancelled';
  if (/^(ENOENT|FILENOTFOUNDERROR|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|MODULENOTFOUNDERROR)$/.test(key)) return 'resource.missing';
  if (/^(EACCES|EPERM|PERMISSIONERROR)$/.test(key)) return 'storage.permission';
  if (key === 'ENOSPC') return 'storage.full';
  if (key === 'INSUFFICIENT_QUOTA') return 'provider.quota';
  if (key === 'MODEL_NOT_FOUND') return 'provider.model_missing';
  if (key === 'CONTEXT_LENGTH_EXCEEDED') return 'provider.context_limit';
  if (/^SQLITE_(BUSY|LOCKED)$/.test(key)) return 'storage.busy';
  if (status === 401 || /^(HTTP_401|AUTHENTICATIONERROR|INVALID_API_KEY|TOKEN_EXPIRED)$/.test(key)) return 'auth.rejected';
  if (/^(NETWORK_DENIED|POLICY_DENIED|TOOLBOUNDARYBLOCKED)$/.test(key)) return 'policy.denied';
  if (status === 403) return 'http.forbidden';
  if (status === 429 || /^(RATE_LIMIT|RATELIMITERROR)$/.test(key)) return 'http.rate_limit';
  if (status && status >= 500) return 'http.server';
  if (status && status >= 400) return 'http.client';
  return 'unknown';
}

export interface DiagnosticFrame { module: string; function?: string; line?: number; column?: number }
export function diagnosticFrames(stack: unknown): DiagnosticFrame[] {
  if (typeof stack !== 'string') return [];
  return stack.slice(0, 16000).split('\n').filter((line) => /^\s*at\s/.test(line)).slice(0, 12).map((line) => {
    const location = line.match(/:(\d+):(\d+)\)?\s*$/);
    const functionName = line.match(/^\s*at\s+(?:async\s+)?([\w.$<>]+)\s+\(/)?.[1];
    const file = line.match(/(?:[/\\]|\b)([\w.-]+\.(?:[cm]?js|tsx?|jsx|asar))(?=[:?#)])/i)?.[1];
    return { module: file ?? '<module>', ...(functionName ? { function: functionName } : {}),
      ...(location ? { line: Number(location[1]), column: Number(location[2]) } : {}) };
  });
}

export function safeErrorFacts(error: unknown): Record<string, unknown> {
  const chain: Array<Record<string, unknown>> = [];
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && chain.length < 5 && !visited.has(current)) {
    visited.add(current);
    const item = current as Record<string, unknown>;
    const type = diagnosticSymbol(item.name) ?? 'Error';
    const code = diagnosticSymbol(item.code);
    const rawStatus = item.status ?? item.statusCode;
    const status = typeof rawStatus === 'number' && Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : undefined;
    chain.push({ error_type: type, ...(code ? { error_code: code } : {}), ...(status ? { status_code: status } : {}),
      error_category: classifyDiagnosticError(code ?? type, status) });
    current = item.cause;
  }
  if (!chain.length) return { error_type: typeof error, error_category: 'unknown' };
  const classified = [...chain].reverse().find((item) => item.error_category !== 'unknown');
  return { ...chain[0], error_category: classified?.error_category ?? 'unknown',
    cause_chain: chain, stack_frames: diagnosticFrames((error as Error).stack) };
}

/** Validate nested technical arrays crossing IPC or read from older log files. */
export function sanitizeErrorArray(key: string, value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const frames = key === 'stack_frames';
  return value.slice(0, frames ? 12 : 5).filter((item) => item && typeof item === 'object').map((item) => {
    const result: Record<string, unknown> = {};
    for (const field of frames ? ['module', 'function'] : ['error_type', 'error_code', 'error_category']) {
      const text = diagnosticSymbol(item[field]);
      if (text) result[field] = text;
    }
    for (const field of frames ? ['line', 'column'] : ['status_code']) {
      if (Number.isSafeInteger(item[field]) && item[field] >= 0) result[field] = item[field];
    }
    return result;
  });
}
