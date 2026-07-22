import { describe, expect, it } from "vitest";

import type { UIMessage } from "@/core/types";
import {
  absorbCompleteAssistantMessage,
  closeReasoningStream,
  finalizeInterruptedTurn,
} from "./useNanobotStream";

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

  it("does not convert an old reasoning placeholder into a completed latency", () => {
    const result = closeReasoningStream([{
      id: "reasoning",
      role: "assistant",
      content: "",
      reasoning: "正在整理思路",
      reasoningStreaming: true,
      isStreaming: true,
      createdAt: Date.now() - 48 * 60 * 60 * 1000,
    }]);

    expect(result[0]).toMatchObject({
      reasoningStreaming: false,
      isStreaming: true,
    });
    expect(result[0].latencyMs).toBeUndefined();
  });

  it("fully closes reasoning and answer streams when the user stops a turn", () => {
    const result = finalizeInterruptedTurn([{
      id: "reasoning",
      role: "assistant",
      content: "",
      reasoning: "正在整理思路",
      reasoningStreaming: true,
      isStreaming: true,
      createdAt: 1,
    }, {
      id: "answer",
      role: "assistant",
      content: "部分回答",
      isStreaming: true,
      createdAt: 2,
    }]);

    expect(result).toEqual([
      expect.objectContaining({ reasoningStreaming: false, isStreaming: false }),
      expect.objectContaining({ reasoningStreaming: false, isStreaming: false }),
    ]);
  });

  it("marks active plan, tool, and file steps as interrupted", () => {
    const [result] = finalizeInterruptedTurn([{
      id: "progress",
      role: "tool",
      kind: "trace",
      content: "正在调研",
      createdAt: 1,
      agentUI: {
        kind: "task_progress",
        current_step_id: "research",
        steps: [{ id: "research", title: "查询资料", status: "running" }],
      },
      toolEvents: [{ phase: "start", call_id: "call-1", name: "web_search" }],
      fileEdits: [{
        call_id: "edit-1",
        tool: "write_file",
        path: "report.md",
        added: 1,
        deleted: 0,
        status: "editing",
      }],
    }]);

    expect(result.agentUI).toMatchObject({
      kind: "task_progress",
      current_step_id: undefined,
      note: "任务已由用户终止",
      steps: [{ status: "error", detail: "已由用户终止" }],
    });
    expect(result.toolEvents?.[0]).toMatchObject({ phase: "error", error: "已由用户终止" });
    expect(result.fileEdits?.[0]).toMatchObject({ status: "error", error: "已由用户终止" });
  });
});
