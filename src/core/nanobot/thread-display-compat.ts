import type { UIMessage } from '@/core/types';

const INTERNAL_TOOL_CALL_OPEN = '<tool_call>';
export const INVALID_ASSISTANT_RESPONSE_TEXT = '未能生成有效回复，请重试或继续询问当前进度。';

export function sanitizeAssistantProtocolLeak(content: string): string {
  const normalized = content.toLowerCase();
  const markerIndex = normalized.indexOf(INTERNAL_TOOL_CALL_OPEN);
  if (
    markerIndex >= 0
    && normalized.indexOf('<function=', markerIndex + INTERNAL_TOOL_CALL_OPEN.length) >= 0
  ) {
    return INVALID_ASSISTANT_RESPONSE_TEXT;
  }
  return content;
}

/**
 * Older WebUI disk snapshots and historical sessions may still contain
 * ``kind: "long_task"`` rows from the retired orchestrator UI. Map them to
 * ordinary trace rows so the thread stays readable without bespoke cards.
 */
export function normalizeLegacyLongTaskMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((m) => {
    const kind = (m as { kind?: string }).kind;
    if (kind !== 'long_task') return m;
    const text = (m.content ?? '').trim() || '(legacy thread activity)';
    return {
      id: m.id,
      role: 'tool',
      kind: 'trace',
      content: text,
      traces: [text],
      createdAt: m.createdAt,
    };
  });
}
