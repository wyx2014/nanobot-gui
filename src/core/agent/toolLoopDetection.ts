/**
 * Tool Loop Detection — adapted from OpenClaw's tool-loop-detection.ts
 *
 * Detects when an AI agent gets stuck in repetitive tool call patterns:
 * 1. generic_repeat — same tool+params called ≥ N times
 * 2. known_poll_no_progress — polling tools returning same result
 * 3. ping_pong — two tool patterns alternating with no progress
 *
 * Browser-safe: uses simple hash instead of node:crypto.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type LoopDetectorKind =
  | 'generic_repeat'
  | 'known_poll_no_progress'
  | 'global_circuit_breaker'
  | 'ping_pong';

export type LoopDetectionResult =
  | { stuck: false }
  | {
    stuck: true;
    level: 'warning' | 'critical';
    detector: LoopDetectorKind;
    count: number;
    message: string;
    pairedToolName?: string;
  };

export interface ToolCallHistoryEntry {
  toolName: string;
  argsHash: string;
  toolCallId?: string;
  resultHash?: string;
  timestamp: number;
}

export interface LoopDetectionState {
  toolCallHistory: ToolCallHistoryEntry[];
}

export interface LoopDetectionConfig {
  enabled?: boolean;
  historySize?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  globalCircuitBreakerThreshold?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

export const TOOL_CALL_HISTORY_SIZE = 30;
export const WARNING_THRESHOLD = 10;
export const CRITICAL_THRESHOLD = 20;
export const GLOBAL_CIRCUIT_BREAKER_THRESHOLD = 30;

const DEFAULT_CONFIG: Required<LoopDetectionConfig> = {
  enabled: true,
  historySize: TOOL_CALL_HISTORY_SIZE,
  warningThreshold: WARNING_THRESHOLD,
  criticalThreshold: CRITICAL_THRESHOLD,
  globalCircuitBreakerThreshold: GLOBAL_CIRCUIT_BREAKER_THRESHOLD,
};

// ── Hash Utilities (browser-safe, no node:crypto) ──────────────────────────

/**
 * Simple, fast, deterministic hash — FNV-1a 32-bit.
 * Good enough for loop detection (collision-resistant enough for short-lived history).
 */
function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0).toString(36);
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function digestStable(value: unknown): string {
  try {
    return fnv1aHash(stableStringify(value));
  } catch {
    return fnv1aHash(String(value));
  }
}

/** Hash a tool call for pattern matching: tool name + deterministic params digest. */
export function hashToolCall(toolName: string, params: unknown): string {
  return `${toolName}:${digestStable(params)}`;
}

// ── Config Resolution ──────────────────────────────────────────────────────────

function resolveConfig(config?: LoopDetectionConfig): Required<LoopDetectionConfig> {
  const asPositiveInt = (v: number | undefined, fallback: number): number =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;

  let warningThreshold = asPositiveInt(config?.warningThreshold, DEFAULT_CONFIG.warningThreshold);
  let criticalThreshold = asPositiveInt(config?.criticalThreshold, DEFAULT_CONFIG.criticalThreshold);
  let globalCircuitBreakerThreshold = asPositiveInt(
    config?.globalCircuitBreakerThreshold,
    DEFAULT_CONFIG.globalCircuitBreakerThreshold
  );

  if (criticalThreshold <= warningThreshold) criticalThreshold = warningThreshold + 1;
  if (globalCircuitBreakerThreshold <= criticalThreshold)
    globalCircuitBreakerThreshold = criticalThreshold + 1;

  return {
    enabled: config?.enabled ?? DEFAULT_CONFIG.enabled,
    historySize: asPositiveInt(config?.historySize, DEFAULT_CONFIG.historySize),
    warningThreshold,
    criticalThreshold,
    globalCircuitBreakerThreshold,
  };
}

// ── Polling Tool Detection ─────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Recognise known polling/status-checking tools by name or action. */
function isKnownPollToolCall(toolName: string, params: unknown): boolean {
  // Ruyi-Cowork's tool names
  if (toolName === 'command_status' || toolName === 'run_command') return false; // run_command is not a poll
  if (toolName === 'command_status') return true;

  // OpenClaw-style process tool
  if (toolName === 'process' && isPlainObject(params)) {
    const action = params.action;
    return action === 'poll' || action === 'log';
  }
  return false;
}

// ── Outcome Hashing (for no-progress detection) ────────────────────────────────

function extractTextContent(result: unknown): string {
  if (typeof result === 'string') return result.trim();
  if (!isPlainObject(result)) return '';
  if (Array.isArray(result.content)) {
    return result.content
      .filter(
        (entry: unknown): entry is { type: string; text: string } =>
          isPlainObject(entry) && typeof entry.type === 'string' && typeof entry.text === 'string'
      )
      .map((entry) => entry.text)
      .join('\n')
      .trim();
  }
  return '';
}

function hashToolOutcome(
  _toolName: string,
  _params: unknown,
  result: unknown,
  error: unknown
): string | undefined {
  if (error !== undefined) {
    const errStr =
      error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
    return `error:${digestStable(errStr)}`;
  }
  if (result === undefined) return undefined;
  if (typeof result === 'string') return digestStable(result);
  const text = extractTextContent(result);
  return digestStable(text);
}

// ── Streak Detectors ───────────────────────────────────────────────────────────

function getNoProgressStreak(
  history: ToolCallHistoryEntry[],
  toolName: string,
  argsHash: string
): { count: number; latestResultHash?: string } {
  let streak = 0;
  let latestResultHash: string | undefined;

  for (let i = history.length - 1; i >= 0; i--) {
    const record = history[i];
    if (!record || record.toolName !== toolName || record.argsHash !== argsHash) continue;
    if (typeof record.resultHash !== 'string' || !record.resultHash) continue;
    if (!latestResultHash) {
      latestResultHash = record.resultHash;
      streak = 1;
      continue;
    }
    if (record.resultHash !== latestResultHash) break;
    streak++;
  }

  return { count: streak, latestResultHash };
}

function getPingPongStreak(
  history: ToolCallHistoryEntry[],
  currentSignature: string
): {
  count: number;
  pairedToolName?: string;
  noProgressEvidence: boolean;
} {
  const last = history.at(-1);
  if (!last) return { count: 0, noProgressEvidence: false };

  // Find a different signature in recent history
  let otherSignature: string | undefined;
  let otherToolName: string | undefined;
  for (let i = history.length - 2; i >= 0; i--) {
    const call = history[i];
    if (!call) continue;
    if (call.argsHash !== last.argsHash) {
      otherSignature = call.argsHash;
      otherToolName = call.toolName;
      break;
    }
  }

  if (!otherSignature || !otherToolName) return { count: 0, noProgressEvidence: false };

  // Count alternating tail
  let alternatingTailCount = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const call = history[i];
    if (!call) continue;
    const expected = alternatingTailCount % 2 === 0 ? last.argsHash : otherSignature;
    if (call.argsHash !== expected) break;
    alternatingTailCount++;
  }

  if (alternatingTailCount < 2) return { count: 0, noProgressEvidence: false };
  if (currentSignature !== otherSignature) return { count: 0, noProgressEvidence: false };

  // Check no-progress evidence
  const tailStart = Math.max(0, history.length - alternatingTailCount);
  let firstHashA: string | undefined;
  let firstHashB: string | undefined;
  let noProgressEvidence = true;

  for (let i = tailStart; i < history.length; i++) {
    const call = history[i];
    if (!call || !call.resultHash) {
      noProgressEvidence = false;
      break;
    }
    if (call.argsHash === last.argsHash) {
      if (!firstHashA) firstHashA = call.resultHash;
      else if (firstHashA !== call.resultHash) {
        noProgressEvidence = false;
        break;
      }
    } else if (call.argsHash === otherSignature) {
      if (!firstHashB) firstHashB = call.resultHash;
      else if (firstHashB !== call.resultHash) {
        noProgressEvidence = false;
        break;
      }
    } else {
      noProgressEvidence = false;
      break;
    }
  }

  if (!firstHashA || !firstHashB) noProgressEvidence = false;

  return {
    count: alternatingTailCount + 1,
    pairedToolName: last.toolName,
    noProgressEvidence,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Detect if an agent is stuck in a repetitive tool call loop.
 * Call this BEFORE executing a tool call.
 */
export function detectToolCallLoop(
  state: LoopDetectionState,
  toolName: string,
  params: unknown,
  config?: LoopDetectionConfig
): LoopDetectionResult {
  const cfg = resolveConfig(config);
  if (!cfg.enabled) return { stuck: false };

  const history = state.toolCallHistory ?? [];
  const currentHash = hashToolCall(toolName, params);
  const noProgress = getNoProgressStreak(history, toolName, currentHash);
  const noProgressStreak = noProgress.count;
  const knownPollTool = isKnownPollToolCall(toolName, params);
  const pingPong = getPingPongStreak(history, currentHash);

  // Global circuit breaker — any tool repeated too many times
  if (noProgressStreak >= cfg.globalCircuitBreakerThreshold) {
    return {
      stuck: true,
      level: 'critical',
      detector: 'global_circuit_breaker',
      count: noProgressStreak,
      message: `⚠️ 严重：工具 ${toolName} 已经以相同参数重复调用了 ${noProgressStreak} 次且无进展。循环已被阻断以防止资源浪费。请换一种方式处理任务。`,
    };
  }

  // Known poll tool — critical
  if (knownPollTool && noProgressStreak >= cfg.criticalThreshold) {
    return {
      stuck: true,
      level: 'critical',
      detector: 'known_poll_no_progress',
      count: noProgressStreak,
      message: `⚠️ 严重：工具 ${toolName} 已轮询 ${noProgressStreak} 次且结果完全相同。这看起来是一个死循环。请停止轮询并报告任务状态。`,
    };
  }

  // Known poll tool — warning
  if (knownPollTool && noProgressStreak >= cfg.warningThreshold) {
    return {
      stuck: true,
      level: 'warning',
      detector: 'known_poll_no_progress',
      count: noProgressStreak,
      message: `⚠️ 警告：工具 ${toolName} 已轮询 ${noProgressStreak} 次且无进展。请增加等待间隔，或判断进程是否已卡住并报告失败。`,
    };
  }

  // Ping-pong — critical
  if (pingPong.count >= cfg.criticalThreshold && pingPong.noProgressEvidence) {
    return {
      stuck: true,
      level: 'critical',
      detector: 'ping_pong',
      count: pingPong.count,
      message: `⚠️ 严重：检测到 ${pingPong.count} 次工具交替调用模式且无进展。这是一个乒乓死循环。请停止并报告任务失败。`,
      pairedToolName: pingPong.pairedToolName,
    };
  }

  // Ping-pong — warning
  if (pingPong.count >= cfg.warningThreshold) {
    return {
      stuck: true,
      level: 'warning',
      detector: 'ping_pong',
      count: pingPong.count,
      message: `⚠️ 警告：检测到 ${pingPong.count} 次工具交替调用模式。看起来像一个乒乓循环，请停止重试并换一种方式。`,
      pairedToolName: pingPong.pairedToolName,
    };
  }

  // Generic repeat — warning only (non-poll tools)
  const recentCount = history.filter(
    (h) => h.toolName === toolName && h.argsHash === currentHash
  ).length;

  if (!knownPollTool && recentCount >= cfg.warningThreshold) {
    return {
      stuck: true,
      level: 'warning',
      detector: 'generic_repeat',
      count: recentCount,
      message: `⚠️ 警告：工具 ${toolName} 已经用相同参数调用了 ${recentCount} 次。如果没有取得进展，请停止重试并报告任务失败。`,
    };
  }

  return { stuck: false };
}

/**
 * Record a tool call in the session history for loop detection.
 * Call this BEFORE executing a tool call (after detect).
 */
export function recordToolCall(
  state: LoopDetectionState,
  toolName: string,
  params: unknown,
  toolCallId?: string,
  config?: LoopDetectionConfig
): void {
  const cfg = resolveConfig(config);
  if (!state.toolCallHistory) state.toolCallHistory = [];

  state.toolCallHistory.push({
    toolName,
    argsHash: hashToolCall(toolName, params),
    toolCallId,
    timestamp: Date.now(),
  });

  if (state.toolCallHistory.length > cfg.historySize) {
    state.toolCallHistory.shift();
  }
}

/**
 * Record a completed tool call outcome for no-progress detection.
 * Call this AFTER a tool call completes (success or error).
 */
export function recordToolCallOutcome(
  state: LoopDetectionState,
  params: {
    toolName: string;
    toolParams: unknown;
    toolCallId?: string;
    result?: unknown;
    error?: unknown;
  },
  config?: LoopDetectionConfig
): void {
  const cfg = resolveConfig(config);
  const resultHash = hashToolOutcome(params.toolName, params.toolParams, params.result, params.error);
  if (!resultHash) return;

  if (!state.toolCallHistory) state.toolCallHistory = [];

  const argsHash = hashToolCall(params.toolName, params.toolParams);
  let matched = false;

  for (let i = state.toolCallHistory.length - 1; i >= 0; i--) {
    const call = state.toolCallHistory[i];
    if (!call) continue;
    if (params.toolCallId && call.toolCallId !== params.toolCallId) continue;
    if (call.toolName !== params.toolName || call.argsHash !== argsHash) continue;
    if (call.resultHash !== undefined) continue;
    call.resultHash = resultHash;
    matched = true;
    break;
  }

  if (!matched) {
    state.toolCallHistory.push({
      toolName: params.toolName,
      argsHash,
      toolCallId: params.toolCallId,
      resultHash,
      timestamp: Date.now(),
    });
  }

  if (state.toolCallHistory.length > cfg.historySize) {
    state.toolCallHistory.splice(0, state.toolCallHistory.length - cfg.historySize);
  }
}

/** Create a fresh loop detection state. */
export function createLoopDetectionState(): LoopDetectionState {
  return { toolCallHistory: [] };
}
