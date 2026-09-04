import { describe, expect, it } from "vitest";

import {
  INVALID_ASSISTANT_RESPONSE_TEXT,
  normalizeLegacyLongTaskMessages,
  sanitizeAssistantProtocolLeak,
} from "./thread-display-compat";
import type { UIMessage } from "@/core/types";

describe("normalizeLegacyLongTaskMessages", () => {
  it("maps legacy long_task rows to trace lines", () => {
    const legacy = {
      id: "x",
      role: "assistant",
      kind: "long_task",
      content: "long_task · done",
      createdAt: 1,
    } as unknown as UIMessage;
    const out = normalizeLegacyLongTaskMessages([legacy]);
    expect(out[0]!.kind).toBe("trace");
    expect(out[0]!.role).toBe("tool");
    expect(out[0]!.traces).toEqual(["long_task · done"]);
  });

  it("replaces a serialized internal tool call with a user-facing retry message", () => {
    const leaked = [
      '<tool_call>',
      '<function=update_task_progress>',
      '<parameter=current_step_id>2</parameter>',
      '</function>',
      '</tool_call>',
    ].join('\n');

    expect(sanitizeAssistantProtocolLeak(leaked)).toBe(INVALID_ASSISTANT_RESPONSE_TEXT);
    expect(sanitizeAssistantProtocolLeak(`准备创建文件。${leaked}`)).toBe(INVALID_ASSISTANT_RESPONSE_TEXT);
    expect(sanitizeAssistantProtocolLeak('这里是正常的 <tool_call> 说明')).toBe('这里是正常的 <tool_call> 说明');
  });
});
