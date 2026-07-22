import { describe, expect, it } from "vitest";

import type { UIMessage } from "@/core/types";
import { absorbCompleteAssistantMessage } from "./useNanobotStream";

describe("absorbCompleteAssistantMessage", () => {
  it("merges a streamed final response with its attachment message", () => {
    const streamed: UIMessage = {
      id: "streamed-report",
      role: "assistant",
      content: "青岛啤酒（600600.SH）投资研究报告",
      isStreaming: true,
      createdAt: 1,
    };

    const result = absorbCompleteAssistantMessage(
      [
        {
          id: "user",
          role: "user",
          content: "帮我分析青岛啤酒",
          createdAt: 0,
        },
        streamed,
      ],
      {
        content: streamed.content,
        media: [{
          kind: "file",
          url: "/api/media/report",
          name: "青岛啤酒投资研究报告.html",
        }],
      },
      { replaceStream: true },
    );

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      id: "streamed-report",
      role: "assistant",
      content: streamed.content,
      isStreaming: false,
      media: [{
        name: "青岛啤酒投资研究报告.html",
      }],
    });
  });

  it("repairs legacy exact streamed duplicates without a protocol marker", () => {
    const result = absorbCompleteAssistantMessage(
      [{
        id: "legacy-stream",
        role: "assistant",
        content: "完整报告",
        isStreaming: true,
        createdAt: 1,
      }],
      {
        content: "完整报告",
        media: [{ kind: "file", name: "report.html" }],
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("legacy-stream");
    expect(result[0].media?.[0]?.name).toBe("report.html");
  });
});
