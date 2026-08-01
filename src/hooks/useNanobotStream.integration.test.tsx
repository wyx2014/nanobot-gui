import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboundEvent, TaskProgressStep, UIMessage } from "@/core/types";
import { mapWebuiThreadToGuiMessages } from "@/core/nanobotClient";

const mocks = vi.hoisted(() => ({
  getNanobotClient: vi.fn(),
}));

vi.mock("@/core/nanobotClient", async () => {
  const actual = await vi.importActual<typeof import("@/core/nanobotClient")>(
    "@/core/nanobotClient",
  );
  return {
    ...actual,
    getNanobotClient: mocks.getNanobotClient,
  };
});

import { useNanobotStream } from "./useNanobotStream";
import { useTurnPlanStore } from "@/stores/turnPlanStore";

type StreamSnapshot = ReturnType<typeof useNanobotStream>;
type EventHandler = (event: InboundEvent) => void;

let container: HTMLDivElement | undefined;
let root: Root | undefined;
let latest: StreamSnapshot | undefined;
let eventHandler: EventHandler | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({
  chatId = "chat-media-progress",
  initialMessages = [],
}: {
  chatId?: string;
  initialMessages?: UIMessage[];
}) {
  const snapshot = useNanobotStream(chatId, initialMessages, true);
  useEffect(() => {
    latest = snapshot;
  }, [snapshot]);
  return null;
}

function emit(event: InboundEvent) {
  act(() => eventHandler?.(event));
}

beforeEach(() => {
  latest = undefined;
  eventHandler = undefined;
  useTurnPlanStore.setState({
    planByConversation: {},
    currentTurnByConversation: {},
  });
  mocks.getNanobotClient.mockReturnValue({
    status: "open",
    getRunStartedAt: () => null,
    getGoalState: () => undefined,
    onError: () => () => {},
    onChat: (_chatId: string, handler: EventHandler) => {
      eventHandler = handler;
      return () => {
        if (eventHandler === handler) eventHandler = undefined;
      };
    },
    sendMessage: vi.fn(),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Harness />));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  latest = undefined;
  eventHandler = undefined;
  vi.clearAllMocks();
});

describe("useNanobotStream media progress lifecycle", () => {
  it("never exposes provisional pre-tool narration in the answer body", () => {
    const narration = "好的，我来为您启动中科曙光四角色并行投研分析。";
    emit({
      event: "delta",
      chat_id: "chat-media-progress",
      text: narration,
      stream_id: "provisional-narration",
    });
    // Flush the animation-frame batch without classifying the delta.
    emit({
      event: "reasoning_end",
      chat_id: "chat-media-progress",
    });

    let projected = mapWebuiThreadToGuiMessages(latest?.messages ?? []);
    expect(projected.some((message) => (
      message.role === "assistant" && message.content === narration
    ))).toBe(false);
    expect(projected.some((message) => message.narration === narration)).toBe(true);

    emit({
      event: "stream_end",
      chat_id: "chat-media-progress",
      stream_id: "provisional-narration",
      resuming: true,
      stream_kind: "narration",
    });
    emit({
      event: "narration_delta",
      chat_id: "chat-media-progress",
      text: narration,
      stream_id: "narration-1",
      replaces_stream_id: "provisional-narration",
    });
    emit({
      event: "narration_end",
      chat_id: "chat-media-progress",
      stream_id: "narration-1",
      replaces_stream_id: "provisional-narration",
    });

    projected = mapWebuiThreadToGuiMessages(latest?.messages ?? []);
    expect(projected.some((message) => (
      message.role === "assistant" && message.content === narration
    ))).toBe(false);
    expect(projected.filter((message) => message.narration === narration)).toHaveLength(1);
  });

  it("exposes live estimated usage and replaces it with provider usage", () => {
    emit({
      event: "turn_usage_updated",
      chat_id: "chat-media-progress",
      turn_id: "turn-usage",
      estimated: true,
      usage: {
        prompt_tokens: 1_200,
        completion_tokens: 34,
        total_tokens: 1_234,
        confirmed_new_tokens: 300,
        new_tokens: 300,
      },
    });

    expect(latest?.turnUsage).toEqual({
      inputTokens: 1_200,
      outputTokens: 34,
      totalTokens: 1_234,
      cachedTokens: 0,
      newTokens: 300,
      estimated: true,
    });

    emit({
      event: "turn_usage_updated",
      chat_id: "chat-media-progress",
      turn_id: "turn-usage",
      estimated: false,
      usage: {
        prompt_tokens: 1_180,
        completion_tokens: 40,
        total_tokens: 1_220,
        cached_tokens: 900,
      },
    });

    expect(latest?.turnUsage).toEqual({
      inputTokens: 1_180,
      outputTokens: 40,
      totalTokens: 1_220,
      cachedTokens: 900,
      newTokens: 320,
      estimated: false,
    });
  });

  it("never lets the active turn's displayed new-token count move backwards", () => {
    emit({
      event: "turn_usage_updated",
      chat_id: "chat-media-progress",
      turn_id: "turn-usage",
      estimated: true,
      usage: {
        prompt_tokens: 100_000,
        completion_tokens: 120,
        total_tokens: 100_120,
        confirmed_new_tokens: 25_000,
        new_tokens: 25_120,
      },
    });

    emit({
      event: "turn_usage_updated",
      chat_id: "chat-media-progress",
      turn_id: "turn-usage",
      estimated: false,
      usage: {
        prompt_tokens: 100_000,
        completion_tokens: 140,
        total_tokens: 100_140,
        cached_tokens: 75_050,
      },
    });

    expect(latest?.turnUsage).toMatchObject({
      totalTokens: 100_140,
      cachedTokens: 75_050,
      newTokens: 25_120,
      estimated: false,
    });
  });

  it("starts asset research with a required data-package step", () => {
    emit({
      event: "team_run_started",
      chat_id: "chat-media-progress",
      run_id: "asset-run",
      team_id: "asset-research-team",
      team_name: "资产投研团队",
      members: [
        {
          id: "business-analyst",
          name: "商业分析师",
          framework: "段永平视角",
          description: "分析商业模式",
        },
        {
          id: "financial-analyst",
          name: "财务分析师",
          framework: "巴菲特视角",
          description: "分析财务与估值",
        },
      ],
    });

    const progress = latest?.messages.find(
      (message) => message.agentUI?.team_run_id === "asset-run",
    )?.agentUI;
    expect(progress?.kind).toBe("task_progress");
    const steps = Array.isArray(progress?.steps)
      ? progress.steps as TaskProgressStep[]
      : [];
    expect(steps.map((step) => [step.id, step.status])).toEqual([
      ["data-package", "running"],
      ["business-analyst", "pending"],
      ["financial-analyst", "pending"],
      ["team-lead", "pending"],
      ["report-audit", "pending"],
    ]);
    expect(progress?.note).toContain("基础数据包");
  });

  it("merges live member activity into an existing canonical workflow plan", () => {
    emit({
      event: "team_run_started",
      chat_id: "chat-media-progress",
      run_id: "live-team-run",
      team_id: "asset-research-team",
      team_name: "资产投研团队",
      members: [{
        id: "financial-analyst",
        name: "财务分析师",
        description: "分析财务与估值",
      }],
    });
    emit({
      event: "turn_plan_created",
      chat_id: "chat-media-progress",
      turn_id: "turn-live-team",
      plan: {
        id: "plan:turn-live-team",
        turn_id: "turn-live-team",
        kind: "workflow",
        owner: "expert_team:asset-research-team",
        policy: "required",
        execution: "staged",
        status: "running",
        revision: 1,
        active_step_ids: ["financial-analyst"],
        team_id: "asset-research-team",
        team_run_id: "live-team-run",
        steps: [
          {
            id: "financial-analyst",
            title: "财务分析师",
            detail: "团队已启动，正在分配研究任务",
            status: "running",
          },
          {
            id: "team-lead",
            title: "主笔交叉质证与汇总",
            status: "pending",
          },
        ],
      },
    });

    emit({
      event: "team_member_updated",
      chat_id: "chat-media-progress",
      run_id: "live-team-run",
      team_id: "asset-research-team",
      member: {
        id: "financial-analyst",
        name: "财务分析师",
        status: "running",
        task_id: "subagent-finance",
        activity: "正在查询聚源利润表、现金流和估值指标",
      },
    });

    const progress = latest?.messages.find(
      (message) => message.agentUI?.team_run_id === "live-team-run",
    )?.agentUI;
    expect(progress?.kind).toBe("task_progress");
    const steps = Array.isArray(progress?.steps)
      ? progress.steps as TaskProgressStep[]
      : [];
    expect(steps.find((step) => step.id === "financial-analyst")).toMatchObject({
      status: "running",
      detail: "正在查询聚源利润表、现金流和估值指标",
    });
  });

  it("does not expose the previous conversation messages after switching chats", () => {
    const chatAMessages: UIMessage[] = [{
      id: "chat-a-plan",
      role: "tool",
      kind: "trace",
      content: "",
      createdAt: 1,
      agentUI: {
        kind: "task_progress",
        turn_id: "turn-a",
        steps: [{ id: "a", title: "A 会话计划", status: "running" }],
      },
    }];

    act(() => root?.render(
      <Harness chatId="chat-a" initialMessages={chatAMessages} />,
    ));
    expect(latest?.messageConversationId).toBe("chat-a");
    expect(latest?.messages[0]?.id).toBe("chat-a-plan");

    act(() => root?.render(
      <Harness chatId="chat-b" initialMessages={[]} />,
    ));
    expect(latest?.messageConversationId).toBe("chat-b");
    expect(latest?.messages).toEqual([]);
  });

  it("switches right-rail progress to the new turn and rejects stale old-turn plans", () => {
    const firstPlan = {
      id: "plan:turn-1",
      turn_id: "turn-1",
      kind: "dynamic" as const,
      owner: "agent",
      policy: "required" as const,
      execution: "serial" as const,
      status: "completed" as const,
      revision: 7,
      active_step_ids: [],
      steps: [{ id: "old", title: "上一轮计划", status: "completed" as const }],
    };
    emit({
      event: "turn_started",
      chat_id: "chat-media-progress",
      snapshot_revision: 1,
      turn: {
        id: "turn-1",
        status: "inProgress",
        started_at: 1,
        plan: firstPlan,
      },
    });
    expect(
      useTurnPlanStore.getState().planByConversation["chat-media-progress"]?.turn_id,
    ).toBe("turn-1");

    emit({
      event: "turn_started",
      chat_id: "chat-media-progress",
      snapshot_revision: 2,
      turn: {
        id: "turn-2",
        status: "inProgress",
        started_at: 2,
      },
    });
    expect(
      useTurnPlanStore.getState().planByConversation["chat-media-progress"],
    ).toBeUndefined();

    emit({
      event: "thread_status_changed",
      chat_id: "chat-media-progress",
      snapshot_revision: 3,
      thread_status: { type: "active" },
      active_turn: {
        id: "turn-2",
        status: "inProgress",
        started_at: 2,
      },
      latest_turn: {
        id: "turn-1",
        status: "completed",
        started_at: 1,
        completed_at: 10,
        plan: firstPlan,
      },
    });
    expect(
      useTurnPlanStore.getState().planByConversation["chat-media-progress"],
    ).toBeUndefined();

    emit({
      event: "message",
      chat_id: "chat-media-progress",
      kind: "progress",
      text: "",
      agent_ui: {
        kind: "task_progress",
        plan_id: "plan:turn-2",
        turn_id: "turn-2",
        revision: 1,
        steps: [
          { id: "new", title: "本轮新计划", status: "running" },
          { id: "deliver", title: "交付结果", status: "pending" },
        ],
      },
    });
    expect(
      useTurnPlanStore.getState().planByConversation["chat-media-progress"],
    ).toMatchObject({
      turn_id: "turn-2",
      revision: 1,
      steps: [{ title: "本轮新计划" }, { title: "交付结果" }],
    });

    emit({
      event: "turn_plan_updated",
      chat_id: "chat-media-progress",
      turn_id: "turn-1",
      plan: {
        ...firstPlan,
        revision: 99,
      },
    });
    expect(
      useTurnPlanStore.getState().planByConversation["chat-media-progress"],
    ).toMatchObject({
      turn_id: "turn-2",
      revision: 1,
    });
  });

  it("keeps structured completion after media and closes the plan on turn_end", () => {
    emit({
      event: "message",
      chat_id: "chat-media-progress",
      kind: "progress",
      text: "正在转换为 PDF",
      agent_ui: {
        kind: "task_progress",
        current_step_id: "convert-pdf",
        steps: [{
          id: "convert-pdf",
          title: "转换为 PDF",
          status: "running",
        }],
      },
    });

    emit({
      event: "message",
      chat_id: "chat-media-progress",
      text: "小红书上市分析报告已生成。",
      media_urls: [{
        url: "/api/media/report-pdf",
        download_url: "/api/media/report-pdf?download=1",
        name: "小红书上市分析报告.pdf",
        kind: "file",
        mime_type: "application/pdf",
      }],
    });

    emit({
      event: "message",
      chat_id: "chat-media-progress",
      kind: "progress",
      text: "PDF 转换完成",
      agent_ui: {
        kind: "task_progress",
        steps: [{
          id: "convert-pdf",
          title: "转换为 PDF",
          status: "completed",
        }],
      },
      tool_events: [{
        phase: "end",
        call_id: "convert-pdf-call",
        name: "convert_to_pdf",
      }],
    });

    emit({
      event: "turn_end",
      chat_id: "chat-media-progress",
      finish_reason: "completed",
    });

    const messages = latest?.messages ?? [];
    const progressFrames = messages.filter(
      (message) => message.agentUI?.kind === "task_progress",
    );
    expect(progressFrames).toHaveLength(2);
    expect(progressFrames.at(-1)?.agentUI).toMatchObject({
      steps: [{ id: "convert-pdf", status: "completed" }],
    });
    expect(progressFrames[0].agentUI).toMatchObject({
      steps: [{ id: "convert-pdf", status: "running" }],
    });
    expect(messages.some((message) => (
      message.media?.some((media) => media.name === "小红书上市分析报告.pdf")
    ))).toBe(true);
    expect(latest?.isStreaming).toBe(false);
  });

  it("stamps authoritative duration and completion time from turn_completed", () => {
    const completedAt = 1_785_222_083_788;
    emit({
      event: "message",
      chat_id: "chat-media-progress",
      text: "天气查询完成。",
    });
    emit({
      event: "turn_completed",
      chat_id: "chat-media-progress",
      snapshot_revision: 2,
      turn: {
        id: "turn-weather",
        status: "completed",
        started_at: completedAt - 23_945,
        completed_at: completedAt,
        duration_ms: 23_945,
      },
    });

    const assistant = [...(latest?.messages ?? [])].reverse().find(
      (message) => message.role === "assistant" && message.kind !== "trace",
    );
    expect(assistant?.latencyMs).toBe(23_945);
    expect(assistant?.completedAt).toBe(completedAt);
    expect(assistant?.isStreaming).toBe(false);
  });

  it("replaces a streamed answer when its authoritative message arrives after completion", () => {
    const finalText = "中科曙光四视角并行投研报告已完成，数据抽检全部通过。";
    emit({
      event: "delta",
      chat_id: "chat-media-progress",
      text: finalText,
      stream_id: "report-stream",
    });
    emit({
      event: "turn_completed",
      chat_id: "chat-media-progress",
      snapshot_revision: 2,
      turn: {
        id: "turn-report",
        status: "completed",
        started_at: 1,
      },
    });
    emit({
      event: "stream_end",
      chat_id: "chat-media-progress",
      stream_id: "report-stream",
    });
    emit({
      event: "message",
      chat_id: "chat-media-progress",
      text: finalText,
      replace_stream: true,
      media_urls: [{
        url: "/api/media/report",
        name: "中科曙光四视角并行投研报告.html",
        kind: "file",
      }],
    });

    const assistant = (latest?.messages ?? []).filter(
      (message) => message.role === "assistant" && message.kind !== "trace",
    );
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toMatchObject({
      content: finalText,
      isStreaming: false,
      media: [{
        name: "中科曙光四视角并行投研报告.html",
      }],
    });
  });

  it("keeps a buffered answer tail in one message when completion precedes stream_end", () => {
    emit({
      event: "delta",
      chat_id: "chat-media-progress",
      text: "完整报告正文。",
      stream_id: "late-terminator-stream",
    });
    // Force the first frame into React state while leaving the answer cursor
    // open, matching a long response whose earlier chunks have rendered.
    emit({
      event: "reasoning_end",
      chat_id: "chat-media-progress",
    });
    expect((latest?.messages ?? []).filter(
      (message) => message.role === "assistant" && message.kind !== "trace",
    )).toHaveLength(1);

    // Production ordering observed in the affected turn: the final delta and
    // lifecycle event arrive in one render batch, while stream_end is queued
    // just after the durable terminal event.
    act(() => {
      eventHandler?.({
        event: "delta",
        chat_id: "chat-media-progress",
        text: "注意板块轮动风险。",
        stream_id: "late-terminator-stream",
      });
      eventHandler?.({
        event: "turn_completed",
        chat_id: "chat-media-progress",
        snapshot_revision: 2,
        turn: {
          id: "turn-late-terminator",
          status: "completed",
          started_at: 1,
          completed_at: 48_096,
          duration_ms: 48_095,
        },
      });
      eventHandler?.({
        event: "stream_end",
        chat_id: "chat-media-progress",
        stream_id: "late-terminator-stream",
      });
    });

    const assistant = (latest?.messages ?? []).filter(
      (message) => message.role === "assistant" && message.kind !== "trace",
    );
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toMatchObject({
      content: "完整报告正文。注意板块轮动风险。",
      isStreaming: false,
      latencyMs: 48_095,
      completedAt: 48_096,
    });
  });

  it("does not misreport a lost final progress snapshot as completed", () => {
    emit({
      event: "message",
      chat_id: "chat-media-progress",
      kind: "progress",
      text: "正在转换为 PDF",
      agent_ui: {
        kind: "task_progress",
        current_step_id: "convert-pdf",
        steps: [{
          id: "convert-pdf",
          title: "转换为 PDF",
          status: "running",
        }],
      },
    });
    emit({
      event: "message",
      chat_id: "chat-media-progress",
      text: "PDF 已生成。",
      media_urls: [{
        url: "/api/media/report-pdf",
        name: "report.pdf",
        mime_type: "application/pdf",
      }],
    });
    emit({
      event: "turn_end",
      chat_id: "chat-media-progress",
      finish_reason: "completed",
    });

    const progress = latest?.messages.find(
      (message) => message.agentUI?.kind === "task_progress",
    );
    expect(progress?.agentUI).toMatchObject({
      current_step_id: "convert-pdf",
      steps: [{ id: "convert-pdf", status: "running" }],
    });
    expect(latest?.isStreaming).toBe(false);
  });
});
