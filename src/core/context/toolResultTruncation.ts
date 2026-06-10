/**
 * Tool Result Truncation — adapted from OpenClaw's tool-result-truncation.ts
 *
 * Intelligently truncates oversized tool results to fit within the model's
 * context window. Uses a head+tail strategy to preserve error messages
 * and summaries that often appear at the end of tool output.
 */

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Maximum share of the context window a single tool result should occupy.
 * Conservative — a single tool result should not consume more than 30%.
 */
const MAX_TOOL_RESULT_CONTEXT_SHARE = 0.3;

/**
 * Hard character limit for a single tool result text block.
 * Safety net for very large context windows.
 */
export const HARD_MAX_TOOL_RESULT_CHARS = 400_000;

/** Minimum characters to keep when truncating. */
const MIN_KEEP_CHARS = 2_000;

/** Suffix appended to truncated tool results. */
const TRUNCATION_SUFFIX =
  '\n\n⚠️ [内容已被截断 — 原始内容过大。以上是部分视图。' +
  '如需更多信息，请指定具体范围或使用分页参数读取更小的内容块。]';

/** Marker between head and tail in head+tail truncation. */
const MIDDLE_OMISSION_MARKER = '\n\n⚠️ [... 中间内容已省略 — 显示头部和尾部 ...]\n\n';

// ── Internal Helpers ───────────────────────────────────────────────────────────

/**
 * Detect whether text likely contains error/diagnostic content near the end,
 * which should be preserved during truncation.
 */
function hasImportantTail(text: string): boolean {
  const tail = text.slice(-2000).toLowerCase();
  return (
    /\b(error|exception|failed|fatal|traceback|panic|stack trace|errno|exit code)\b/.test(tail) ||
    /\}\s*$/.test(tail.trim()) ||
    /\b(total|summary|result|complete|finished|done)\b/.test(tail)
  );
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface TruncationOptions {
  suffix?: string;
  minKeepChars?: number;
}

/**
 * Truncate a single text string to fit within maxChars.
 *
 * Uses a head+tail strategy when the tail contains important content
 * (errors, results, JSON structure), otherwise preserves the beginning.
 */
export function truncateToolResultText(
  text: string,
  maxChars: number,
  options: TruncationOptions = {}
): string {
  const suffix = options.suffix ?? TRUNCATION_SUFFIX;
  const minKeepChars = options.minKeepChars ?? MIN_KEEP_CHARS;

  if (text.length <= maxChars) return text;

  const budget = Math.max(minKeepChars, maxChars - suffix.length);

  // Head+tail when tail has important content
  if (hasImportantTail(text) && budget > minKeepChars * 2) {
    const tailBudget = Math.min(Math.floor(budget * 0.3), 4_000);
    const headBudget = budget - tailBudget - MIDDLE_OMISSION_MARKER.length;

    if (headBudget > minKeepChars) {
      // Clean cut at newline boundaries
      let headCut = headBudget;
      const headNewline = text.lastIndexOf('\n', headBudget);
      if (headNewline > headBudget * 0.8) headCut = headNewline;

      let tailStart = text.length - tailBudget;
      const tailNewline = text.indexOf('\n', tailStart);
      if (tailNewline !== -1 && tailNewline < tailStart + tailBudget * 0.2) {
        tailStart = tailNewline + 1;
      }

      return text.slice(0, headCut) + MIDDLE_OMISSION_MARKER + text.slice(tailStart) + suffix;
    }
  }

  // Default: keep the beginning, cut at newline boundary
  let cutPoint = budget;
  const lastNewline = text.lastIndexOf('\n', budget);
  if (lastNewline > budget * 0.8) cutPoint = lastNewline;

  return text.slice(0, cutPoint) + suffix;
}

/**
 * Calculate the maximum allowed characters for a single tool result
 * based on the model's context window tokens.
 *
 * Uses ~4 chars ≈ 1 token heuristic (conservative for English/Chinese text).
 */
export function calculateMaxToolResultChars(contextWindowTokens: number): number {
  const maxTokens = Math.floor(contextWindowTokens * MAX_TOOL_RESULT_CONTEXT_SHARE);
  const maxChars = maxTokens * 4;
  return Math.min(maxChars, HARD_MAX_TOOL_RESULT_CHARS);
}

/**
 * Check if a tool result string exceeds the size limit for a given context window.
 */
export function isOversizedToolResult(resultText: string, contextWindowTokens: number): boolean {
  return resultText.length > calculateMaxToolResultChars(contextWindowTokens);
}

/**
 * Truncate a tool result string if it exceeds the limit for the given context window.
 * Returns the original string if within limits.
 */
export function truncateIfOversized(
  resultText: string,
  contextWindowTokens: number,
  options?: TruncationOptions
): { text: string; truncated: boolean } {
  const maxChars = calculateMaxToolResultChars(contextWindowTokens);
  if (resultText.length <= maxChars) {
    return { text: resultText, truncated: false };
  }
  return {
    text: truncateToolResultText(resultText, maxChars, options),
    truncated: true,
  };
}
