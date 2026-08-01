import { describe, expect, it } from "vitest";

import type { UIMessage } from "@/core/types";
import {
  absorbCompleteAssistantMessage,
  attachNarrationChunk,
  closeNarrationStream,
  closeReasoningStream,
  finalizeCompletedTurnProgress,
  finalizeFailedTurnProgress,
  finalizeInterruptedTurn,
  isNarrationStreamEnd,
  normalizeTurnUsage,
  reclassifyAssistantStreamAsNarration,
} from "./useNanobotStream";

describe("absorbCompleteAssistantMessage", () => {
  it("normalizes provider token usage from turn_end", () => {
    expect(normalizeTurnUsage({
      prompt_tokens: 120,
      completion_tokens: 34,
      total_tokens: 154,
    })).toEqual({
      inputTokens: 120,
      outputTokens: 34,
    });
    expect(normalizeTurnUsage(undefined)).toBeUndefined();
  });

  it("recognizes both canonical narration stream-end markers", () => {
    expect(isNarrationStreamEnd({
      event: "stream_end",
      chat_id: "chat",
      resuming: true,
    })).toBe(true);
    expect(isNarrationStreamEnd({
      event: "stream_end",
      chat_id: "chat",
      stream_kind: "narration",
    })).toBe(true);
    expect(isNarrationStreamEnd({
      event: "stream_end",
      chat_id: "chat",
      stream_kind: "final",
    })).toBe(false);
  });

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
      createdAt: 1_000,
      reasoningStartedAt: 2_000,
    }], 14_000);

    expect(result[0]).toMatchObject({
      reasoningStreaming: false,
      isStreaming: true,
      reasoningStartedAt: 2_000,
      reasoningCompletedAt: 14_000,
      reasoningDurationMs: 12_000,
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
      steps: [{ status: "interrupted", detail: "已由用户终止" }],
    });
    expect(result.toolEvents?.[0]).toMatchObject({ phase: "error", error: "已由用户终止" });
    expect(result.fileEdits?.[0]).toMatchObject({ status: "error", error: "已由用户终止" });
  });

  it("closes a failed turn as error without claiming pending work completed", () => {
    const [result] = finalizeFailedTurnProgress([{
      id: "failed-progress",
      role: "tool",
      kind: "trace",
      content: "转换中",
      createdAt: 1,
      agentUI: {
        kind: "task_progress",
        current_step_id: "convert",
        steps: [
          { id: "convert", title: "转换为 PDF", detail: "生成文件", status: "running" },
          { id: "deliver", title: "交付 PDF", status: "pending" },
        ],
      },
    }]);

    expect(result.agentUI).toMatchObject({
      current_step_id: undefined,
      steps: [
        { status: "error", detail: "生成文件（执行失败）" },
        { status: "skipped" },
      ],
    });
  });

  it("terminalizes a completed plan without inventing work for pending steps", () => {
    const [result] = finalizeCompletedTurnProgress([{
      id: "completed-progress",
      role: "tool",
      kind: "trace",
      content: "处理中",
      createdAt: 1,
      agentUI: {
        kind: "task_progress",
        current_step_id: "write",
        steps: [
          { id: "write", title: "写报告", status: "running" },
          { id: "extra", title: "补充材料", status: "pending" },
        ],
      },
    }]);

    expect(result.agentUI).toMatchObject({
      current_step_id: undefined,
      steps: [
        { status: "completed" },
        { status: "skipped" },
      ],
    });
  });

  it("terminalizes every progress card in the completed user turn", () => {
    const result = finalizeCompletedTurnProgress([
      {
        id: "user",
        role: "user",
        content: "研究公司",
        createdAt: 1,
      },
      {
        id: "team-progress",
        role: "tool",
        kind: "trace",
        content: "团队研究",
        createdAt: 2,
        agentUI: {
          kind: "task_progress",
          steps: [
            { id: "member", title: "财务分析", status: "running" },
            { id: "audit", title: "报告审校", status: "pending" },
          ],
        },
      },
      {
        id: "canonical-progress",
        role: "tool",
        kind: "trace",
        content: "总计划",
        createdAt: 3,
        agentUI: {
          kind: "task_progress",
          steps: [{ id: "deliver", title: "交付报告", status: "running" }],
        },
      },
    ]);

    expect(result[1].agentUI).toMatchObject({
      steps: [{ status: "completed" }, { status: "skipped" }],
    });
    expect(result[2].agentUI).toMatchObject({
      steps: [{ status: "completed" }],
    });
  });

  it("moves a resuming answer stream into public narration without leaking private reasoning", () => {
    const result = reclassifyAssistantStreamAsNarration([{
      id: "provisional",
      role: "assistant",
      content: "Let me fetch more detailed market data.",
      reasoning: "hidden chain of thought",
      reasoningStreaming: false,
      isStreaming: true,
      streamId: "answer-stream-1",
      createdAt: 1,
    }], {
      streamId: "answer-stream-1",
      ensureActivitySegment: () => "activity-1",
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "provisional",
      role: "assistant",
      content: "",
      reasoning: "hidden chain of thought",
      isStreaming: false,
    });
    expect(result[0].streamId).toBeUndefined();
    expect(result[1]).toMatchObject({
      id: "provisional-narration",
      role: "tool",
      kind: "trace",
      content: "",
      narration: "Let me fetch more detailed market data.",
      streamId: "answer-stream-1",
      activitySegmentId: "activity-1",
    });
    expect(result[1].narration).not.toContain("hidden chain of thought");
  });

  it("replaces a provisional narration by stream id instead of duplicating it", () => {
    const provisional = reclassifyAssistantStreamAsNarration([{
      id: "provisional",
      role: "assistant",
      content: "Let me fetch more",
      isStreaming: true,
      streamId: "provisional-stream",
      createdAt: 1,
    }], { streamId: "provisional-stream" });

    const firstChunk = attachNarrationChunk(
      provisional,
      "Let me fetch more detailed ",
      {
        streamId: "narration-stream",
        replacesStreamId: "provisional-stream",
      },
    );
    const replaced = attachNarrationChunk(
      firstChunk,
      "market data from specific articles.",
      {
        streamId: "narration-stream",
        replacesStreamId: "provisional-stream",
      },
    );
    const closed = closeNarrationStream(replaced, "narration-stream");

    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      role: "tool",
      kind: "trace",
      content: "",
      narration: "Let me fetch more detailed market data from specific articles.",
      narrationStreaming: false,
      isStreaming: false,
      streamId: "provisional-stream",
      narrationStreamId: "narration-stream",
    });
  });

  it("can reclassify a resuming stream by captured message id when stream_id is absent", () => {
    const result = reclassifyAssistantStreamAsNarration([{
      id: "captured-message",
      role: "assistant",
      content: "I will continue with a tool.",
      isStreaming: true,
      createdAt: 1,
    }], {
      messageId: "captured-message",
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: "captured-message",
        kind: "trace",
        content: "",
        narration: "I will continue with a tool.",
      }),
    ]);
  });

  it("keeps a later final answer separate from completed narration", () => {
    const narration = closeNarrationStream(attachNarrationChunk(
      [],
      "I will read the source articles next.",
      { streamId: "narration-direct" },
    ));
    const completed = absorbCompleteAssistantMessage(narration, {
      content: "Here is the final market analysis.",
    });

    expect(completed).toHaveLength(2);
    expect(completed[0]).toMatchObject({
      kind: "trace",
      content: "",
      narration: "I will read the source articles next.",
    });
    expect(completed[1]).toMatchObject({
      role: "assistant",
      content: "Here is the final market analysis.",
    });
  });
});
