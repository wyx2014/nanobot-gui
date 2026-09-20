import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboundEvent, TaskProgressStep, ThreadRuntimeSnapshot, UIMessage } from "@/core/types";
import { mapWebuiThreadToGuiMessages } from "@/core/nanobotClient";
import { NanobotClient } from "@/core/nanobot-client";

const mocks = vi.hoisted(() => ({
  getNanobotClient: vi.fn(),
  sendMessage: vi.fn(),
  respondSecurityApproval: vi.fn(),
  fetchSessionRuntimeSnapshot: vi.fn(),
}));

vi.mock("@/core/nanobotClient", async () => {
  const actual = await vi.importActual<typeof import("@/core/nanobotClient")>(
    "@/core/nanobotClient",
  );
  return {
    ...actual,
    getNanobotClient: mocks.getNanobotClient,
    getGatewayBaseUrl: () => 'http://127.0.0.1:8900',
    getNanobotToken: () => 'test-token',
  };
});

vi.mock("@/core/api", async () => ({
  ...await vi.importActual<typeof import("@/core/api")>("@/core/api"),
  fetchSessionRuntimeSnapshot: mocks.fetchSessionRuntimeSnapshot,
}));

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
  const runtimeClient = new NanobotClient({ url: 'ws://test', reconnect: false });
  mocks.sendMessage.mockImplementation(() => `stop-${mocks.sendMessage.mock.calls.length}`);
  mocks.fetchSessionRuntimeSnapshot.mockReset();
  mocks.getNanobotClient.mockReturnValue({
    status: "open",
    getRunStartedAt: () => null,
    getGoalState: () => undefined,
    getRuntimeSnapshot: runtimeClient.getRuntimeSnapshot.bind(runtimeClient),
    applyRuntimeSnapshot: runtimeClient.applyRuntimeSnapshot.bind(runtimeClient),
    onRuntimeSnapshot: runtimeClient.onRuntimeSnapshot.bind(runtimeClient),
    onError: () => () => {},
    onChat: (_chatId: string, handler: EventHandler) => {
      eventHandler = handler;
      return () => {
        if (eventHandler === handler) eventHandler = undefined;
      };
    },
    sendMessage: mocks.sendMessage,
    respondSecurityApproval: mocks.respondSecurityApproval,
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
  vi.useRealTimers();
});

const idleStopSnapshot = (): ThreadRuntimeSnapshot => ({
  session_key: 'websocket:chat-media-progress',
  runtime_epoch: 'epoch-stop',
  snapshot_revision: 2,
  thread_status: { type: 'idle' },
  active_turn: null,
  latest_turn: null,
});

describe('stop confirmation recovery', () => {
  it('confirms an already idle backend without requiring a turn_end event', () => {
    act(() => latest?.stop());
    emit({ event: 'stop_result', chat_id: 'chat-media-progress', client_action_id: 'stop-1',
      status: 'stopped', runtime_snapshot: idleStopSnapshot() });
    expect(latest?.isStreaming).toBe(false);
    expect(latest?.isStopping).toBe(false);
    expect(latest?.messages).toEqual([]);
  });

  it('reconciles a missing confirmation against a fresh idle snapshot', async () => {
    vi.useFakeTimers();
    mocks.fetchSessionRuntimeSnapshot.mockResolvedValue(idleStopSnapshot());
    act(() => latest?.stop());
    emit({ event: 'message', chat_id: 'chat-media-progress', text: '没有运行中的任务。' });
    expect(latest?.isStopping).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(mocks.fetchSessionRuntimeSnapshot).toHaveBeenCalledWith(
      'test-token', 'websocket:chat-media-progress', 'http://127.0.0.1:8900', expect.any(AbortSignal),
    );
    expect(latest?.isStreaming).toBe(false);
    expect(latest?.isStopping).toBe(false);
    expect(latest?.streamError).toBeNull();
  });

  it('retains running state and permits retry when fresh state is active', async () => {
    vi.useFakeTimers();
    mocks.fetchSessionRuntimeSnapshot.mockResolvedValue({
      ...idleStopSnapshot(), thread_status: { type: 'active', active_flags: [] },
    });
    act(() => latest?.stop());
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(latest?.isStreaming).toBe(true);
    expect(latest?.isStopping).toBe(false);
    expect(latest?.streamError).toMatchObject({ kind: 'stop_unconfirmed', reason: 'active' });
    act(() => latest?.stop());
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    expect(latest?.isStopping).toBe(true);
    // The old request's delayed reply must not end the new attempt.
    emit({ event: 'stop_result', chat_id: 'chat-media-progress', client_action_id: 'stop-1',
      status: 'stopped', runtime_snapshot: idleStopSnapshot() });
    expect(latest?.isStopping).toBe(true);
  });

  it.each(['rejects', 'hangs'] as const)('restores retry when the runtime query %s', async (mode) => {
    vi.useFakeTimers();
    if (mode === 'rejects') mocks.fetchSessionRuntimeSnapshot.mockRejectedValue(new Error('offline'));
    else mocks.fetchSessionRuntimeSnapshot.mockReturnValue(new Promise(() => {}));
    act(() => latest?.stop());
    await act(async () => { await vi.advanceTimersByTimeAsync(13_000); });
    expect(latest?.isStreaming).toBe(true);
    expect(latest?.isStopping).toBe(false);
    expect(latest?.streamError).toMatchObject({ kind: 'stop_unconfirmed', reason: 'unreachable' });
    act(() => latest?.stop());
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('accepts delayed completion after a pending acknowledgement', () => {
    act(() => latest?.stop());
    emit({ event: 'stop_result', chat_id: 'chat-media-progress', client_action_id: 'stop-1',
      status: 'stopping', runtime_snapshot: idleStopSnapshot() });
    expect(latest?.isStreaming).toBe(true);
    expect(latest?.isStopping).toBe(false);
    emit({ event: 'stop_result', chat_id: 'chat-media-progress', client_action_id: 'stop-1',
      status: 'stopped', runtime_snapshot: idleStopSnapshot() });
    expect(latest?.isStreaming).toBe(false);
    expect(latest?.streamError).toBeNull();
  });

  it('ignores a stale idle revision after a newer active snapshot', () => {
    act(() => mocks.getNanobotClient().applyRuntimeSnapshot('chat-media-progress', {
      ...idleStopSnapshot(), snapshot_revision: 3, thread_status: { type: 'active' },
    }));
    act(() => latest?.stop());
    emit({ event: 'stop_result', chat_id: 'chat-media-progress', client_action_id: 'stop-1',
      status: 'stopped', runtime_snapshot: idleStopSnapshot() });
    expect(latest?.isStreaming).toBe(true);
    expect(latest?.isStopping).toBe(false);
  });

  it.each(['switch', 'new turn', 'unmount'] as const)('ignores an in-flight query after %s', async (action) => {
    vi.useFakeTimers();
    let resolve!: (snapshot: ThreadRuntimeSnapshot) => void;
    mocks.fetchSessionRuntimeSnapshot.mockReturnValue(new Promise((done) => { resolve = done; }));
    act(() => latest?.stop());
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    const signal = mocks.fetchSessionRuntimeSnapshot.mock.calls[0][3] as AbortSignal;
    if (action === 'switch') act(() => root?.render(<Harness chatId='another-chat' />));
    else if (action === 'new turn') {
      emit({ event: 'turn_end', chat_id: 'chat-media-progress', finish_reason: 'cancelled' });
      act(() => latest?.send('新任务'));
    } else act(() => { root?.unmount(); root = undefined; });
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(idleStopSnapshot()); });
    if (action !== 'unmount') expect(latest?.isStreaming).toBe(true);
    expect(mocks.getNanobotClient().getRuntimeSnapshot('chat-media-progress')).toBeUndefined();
  });

  it('cancels its timeout on a normal terminal event', async () => {
    vi.useFakeTimers();
    act(() => latest?.stop());
    emit({ event: 'turn_end', chat_id: 'chat-media-progress', finish_reason: 'cancelled' });
    await act(async () => { await vi.advanceTimersByTimeAsync(13_000); });
    expect(mocks.fetchSessionRuntimeSnapshot).not.toHaveBeenCalled();
  });

  it('ignores an old stop acknowledgement after a different turn becomes active', () => {
    const client = mocks.getNanobotClient();
    act(() => client.applyRuntimeSnapshot('chat-media-progress', {
      ...idleStopSnapshot(), thread_status: { type: 'active' },
      active_turn: { id: 'old-turn', status: 'inProgress', started_at: 1 },
    }));
    act(() => latest?.stop());
    act(() => client.applyRuntimeSnapshot('chat-media-progress', {
      ...idleStopSnapshot(), snapshot_revision: 3, thread_status: { type: 'active' },
      active_turn: { id: 'new-turn', status: 'inProgress', started_at: 2 },
    }));
    emit({ event: 'stop_result', chat_id: 'chat-media-progress', client_action_id: 'stop-1',
      status: 'stopped', runtime_snapshot: idleStopSnapshot() });
    expect(latest?.isStreaming).toBe(true);
    expect(latest?.isStopping).toBe(false);
    expect(latest?.streamError).toBeNull();
  });

  it('does not queue stop while disconnected', () => {
    mocks.getNanobotClient().status = 'reconnecting';
    act(() => latest?.stop());
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(latest?.isStopping).toBe(false);
    expect(latest?.streamError).toMatchObject({ kind: 'stop_unconfirmed' });
  });
});

describe("useNanobotStream media progress lifecycle", () => {
  it("holds a high-risk approval for the active chat and sends the scoped response", () => {
    emit({
      event: "security_approval_required",
      chat_id: "chat-media-progress",
      approval: {
        approval_id: "sap_test",
        tool_call_id: "call-test",
        tool_name: "exec",
        risk: "high",
        rule_id: "command.recursive_delete",
        summary: "递归删除需要确认",
        target: "rm -rf build",
        scope: "turn",
      },
    });

    expect(latest?.securityApproval).toMatchObject({
      approval_id: "sap_test",
      status: "pending",
    });
    expect(latest?.respondSecurityApproval("allow_turn")).toBe(true);
    expect(mocks.respondSecurityApproval).toHaveBeenCalledWith(
      "chat-media-progress",
      "sap_test",
      "allow_turn",
    );

    emit({
      event: "security_approval_resolved",
      chat_id: "chat-media-progress",
      approval_id: "sap_test",
      decision: "allow_turn",
      accepted: true,
    });
    expect(latest?.securityApproval).toBeNull();
  });

  it("keeps streaming visible while stop waits for gateway confirmation", () => {
    expect(latest?.isStreaming).toBe(true);

    act(() => latest?.stop());

    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledWith("chat-media-progress", "/stop");
    expect(latest?.isStreaming).toBe(true);
    expect(latest?.isStopping).toBe(true);

    act(() => latest?.stop());
    expect(mocks.sendMessage).toHaveBeenCalledOnce();

    emit({
      event: "turn_end",
      chat_id: "chat-media-progress",
      finish_reason: "cancelled",
    });

    expect(latest?.isStreaming).toBe(false);
    expect(latest?.isStopping).toBe(false);
  });

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
      team_name: "资产投研团队 · 个股研究",
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

  it("starts bottleneck research with a scope brief before both member waves", () => {
    emit({
      event: "team_run_started",
      chat_id: "chat-media-progress",
      run_id: "bottleneck-run",
      team_id: "supply-chain-bottleneck-team",
      team_name: "资产投研团队 · 供应链瓶颈研究",
      members: [
        {
          id: "trend-verifier",
          name: "趋势与需求验证师",
          phase: "discovery",
          phase_label: "第一阶段 · 发现",
          description: "验证趋势与需求",
        },
        {
          id: "chain-mapper",
          name: "产业链架构师",
          phase: "discovery",
          phase_label: "第一阶段 · 发现",
          description: "拆解物理产业链",
        },
        {
          id: "company-screener",
          name: "标的映射与估值师",
          phase: "validation",
          phase_label: "第二阶段 · 验证",
          description: "映射公司并验证估值",
        },
      ],
    });

    const progress = latest?.messages.find(
      (message) => message.agentUI?.team_run_id === "bottleneck-run",
    )?.agentUI;
    const steps = Array.isArray(progress?.steps)
      ? progress.steps as TaskProgressStep[]
      : [];
    expect(steps.map((step) => [step.id, step.status])).toEqual([
      ["scope-brief", "running"],
      ["trend-verifier", "pending"],
      ["chain-mapper", "pending"],
      ["company-screener", "pending"],
      ["team-lead", "pending"],
      ["report-audit", "pending"],
    ]);
    expect(progress?.note).toContain("研究主题卡");
  });

  it("merges live member activity into an existing canonical workflow plan", () => {
    emit({
      event: "team_run_started",
      chat_id: "chat-media-progress",
      run_id: "live-team-run",
      team_id: "asset-research-team",
      team_name: "资产投研团队 · 个股研究",
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

  it("replaces a live task-progress revision and keeps its structured completion", () => {
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
    expect(progressFrames).toHaveLength(1);
    expect(progressFrames[0]?.agentUI).toMatchObject({
      steps: [{ id: "convert-pdf", status: "completed" }],
    });
    expect(messages.some((message) => (
      message.media?.some((media) => media.name === "小红书上市分析报告.pdf")
    ))).toBe(true);
    expect(latest?.isStreaming).toBe(false);
  });

  it("keeps 196 revisions of one expert task as one live progress row", () => {
    act(() => {
      for (let revision = 1; revision <= 196; revision += 1) {
        eventHandler?.({
          event: "message",
          chat_id: "chat-media-progress",
          kind: "progress",
          text: "",
          agent_ui: {
            kind: "task_progress",
            plan_id: "plan:expert-research",
            turn_id: "turn:expert-research",
            revision,
            current_step_id: "research",
            steps: [{
              id: "research",
              title: "专家团队分析",
              status: revision === 196 ? "completed" : "running",
            }],
          },
        });
      }
    });

    const progressFrames = (latest?.messages ?? []).filter(
      (message) => message.agentUI?.kind === "task_progress",
    );
    expect(progressFrames).toHaveLength(1);
    expect(progressFrames[0]?.agentUI).toMatchObject({
      plan_id: "plan:expert-research",
      revision: 196,
      steps: [{ id: "research", status: "completed" }],
    });
    expect(progressFrames[0]?.traces).toEqual(["task_progress"]);

    emit({
      event: "message",
      chat_id: "chat-media-progress",
      kind: "progress",
      text: "",
      agent_ui: {
        kind: "task_progress",
        plan_id: "plan:separate-delivery",
        turn_id: "turn:expert-research",
        revision: 1,
        steps: [{
          id: "delivery",
          title: "交付结果",
          status: "running",
        }],
      },
    });
    expect((latest?.messages ?? []).filter(
      (message) => message.agentUI?.kind === "task_progress",
    )).toHaveLength(2);
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

  it("keeps one reply when reasoning briefly interrupts the same answer stream", () => {
    const turnId = "turn-interleaved-reasoning";
    const streamId = "interleaved-answer-stream";
    emit({
      event: "turn_started",
      chat_id: "chat-media-progress",
      snapshot_revision: 1,
      turn: {
        id: turnId,
        status: "inProgress",
        started_at: 1,
      },
    });
    emit({
      event: "reasoning_delta",
      chat_id: "chat-media-progress",
      text: "友好回应用户",
    });
    emit({
      event: "reasoning_end",
      chat_id: "chat-media-progress",
    });
    emit({
      event: "delta",
      chat_id: "chat-media-progress",
      text: "你好",
      stream_id: streamId,
    });
    emit({
      event: "reasoning_delta",
      chat_id: "chat-media-progress",
      text: "。",
    });
    emit({
      event: "reasoning_end",
      chat_id: "chat-media-progress",
    });
    emit({
      event: "delta",
      chat_id: "chat-media-progress",
      text: "！有什么我可以帮你的吗？",
      stream_id: streamId,
    });
    emit({
      event: "stream_end",
      chat_id: "chat-media-progress",
      stream_id: streamId,
      stream_kind: "answer",
      resuming: false,
    });

    const streamingAssistant = (latest?.messages ?? []).filter(
      (message) => message.role === "assistant" && message.kind !== "trace",
    );
    expect(streamingAssistant).toHaveLength(1);
    expect(streamingAssistant[0]).toMatchObject({
      turnId,
      streamId,
      content: "你好！有什么我可以帮你的吗？",
      reasoning: "友好回应用户。",
      isStreaming: true,
    });

    emit({
      event: "message",
      chat_id: "chat-media-progress",
      text: "你好！有什么我可以帮你的吗？",
      replace_stream: true,
    });
    emit({
      event: "turn_completed",
      chat_id: "chat-media-progress",
      snapshot_revision: 2,
      turn: {
        id: turnId,
        status: "completed",
        started_at: 1,
        completed_at: 3_800,
        duration_ms: 3_799,
      },
    });

    const finalAssistant = (latest?.messages ?? []).filter(
      (message) => message.role === "assistant" && message.kind !== "trace",
    );
    expect(finalAssistant).toHaveLength(1);
    expect(finalAssistant[0]).toMatchObject({
      content: "你好！有什么我可以帮你的吗？",
      reasoning: "友好回应用户。",
      isStreaming: false,
    });
  });

  it("reconciles a late tail after stream_end into one authoritative answer", () => {
    const turnId = "turn-import-export";
    const streamId = "answer-stream";
    emit({
      event: "turn_started",
      chat_id: "chat-media-progress",
      snapshot_revision: 1,
      turn: {
        id: turnId,
        status: "inProgress",
        started_at: 1,
      },
    });
    emit({
      event: "delta",
      chat_id: "chat-media-progress",
      text: "根据海关总署数据，完整回答",
      stream_id: streamId,
    });
    emit({
      event: "reasoning_end",
      chat_id: "chat-media-progress",
    });
    emit({
      event: "stream_end",
      chat_id: "chat-media-progress",
      stream_id: streamId,
    });
    // Reproduce a transport/animation-frame tail delivered after the cursor was
    // closed. Previously this created a second provisional assistant row.
    emit({
      event: "delta",
      chat_id: "chat-media-progress",
      text: "：海关总署",
      stream_id: streamId,
    });
    emit({
      event: "message",
      chat_id: "chat-media-progress",
      text: "根据海关总署数据，完整回答\n\n数据来源：海关总署",
      replace_stream: true,
    });
    emit({
      event: "turn_completed",
      chat_id: "chat-media-progress",
      snapshot_revision: 2,
      turn: {
        id: turnId,
        status: "completed",
        started_at: 1,
        completed_at: 89_608,
        duration_ms: 89_607,
      },
    });

    const assistant = (latest?.messages ?? []).filter(
      (message) => message.role === "assistant" && message.kind !== "trace",
    );
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toMatchObject({
      turnId,
      streamId,
      content: "根据海关总署数据，完整回答\n\n数据来源：海关总署",
      isStreaming: false,
      latencyMs: 89_607,
    });
    const projected = mapWebuiThreadToGuiMessages(latest?.messages ?? []);
    expect(projected.some((message) => message.narration === "：海关总署")).toBe(false);
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
