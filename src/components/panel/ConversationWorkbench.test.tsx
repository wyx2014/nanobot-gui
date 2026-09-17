import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initLanguage } from "@/i18n";
import { fetchThreadResource } from "@/core/api";
import { fetchSessionArtifacts, normalizeSessionArtifactRecords, type SessionArtifact } from "@/core/sessionArtifacts";
import type { ThreadResource } from "@/core/types";
import { useChatStore } from "@/stores/chatStore";
import { useConversationWorkbenchStore } from "@/stores/conversationWorkbenchStore";
import { useThreadResourceStore } from "@/stores/threadResourceStore";
import { useTurnPlanStore } from "@/stores/turnPlanStore";
import { useExpertTeamRevisionStore } from "@/stores/expertTeamRevisionStore";
import ConversationWorkbench from "./ConversationWorkbench";

vi.mock("@/core/nanobotClient", async () => ({
  ...await vi.importActual<typeof import("@/core/nanobotClient")>("@/core/nanobotClient"),
  getNanobotToken: () => 'test-token',
  getGatewayBaseUrl: () => 'http://127.0.0.1:8900',
  getNanobotConnectionStatus: () => 'open',
}));

vi.mock("@/core/api", async () => {
  const actual = await vi.importActual<typeof import("@/core/api")>("@/core/api");
  return {
    ...actual,
    fetchThreadResource: vi.fn(() => new Promise(() => {})),
  };
});

vi.mock("@/core/sessionArtifacts", async () => {
  const actual = await vi.importActual<typeof import("@/core/sessionArtifacts")>(
    "@/core/sessionArtifacts",
  );
  return {
    ...actual,
    fetchSessionArtifacts: vi.fn(() => new Promise(() => {})),
  };
});

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderWorkbench(showInitialLoading?: boolean) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(
    <ConversationWorkbench showInitialLoading={showInitialLoading} />,
  ));
  return container;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchSessionArtifacts).mockReset().mockImplementation(() => new Promise(() => {}));
  initLanguage("en-US");
  useExpertTeamRevisionStore.setState({ selection: null });
  useChatStore.setState({
    activeConversationId: "chat-progress",
    conversations: {
      "chat-progress": {
        id: "chat-progress",
        title: "PDF report",
        messages: [],
        createdAt: 1,
        updatedAt: 1,
        status: "idle",
      },
    },
  });
  useConversationWorkbenchStore.setState({
    progressByConversation: {
      "chat-progress": {
        source: "task_progress",
        isActive: false,
        steps: [{
          id: "convert-pdf",
          title: "Convert to PDF",
          status: "running",
        }],
      },
    },
    artifactRevisionByConversation: {},
  });
  useTurnPlanStore.setState({
    planByConversation: {},
    currentTurnByConversation: {},
  });
  useThreadResourceStore.setState({
    resourcesBySession: {},
    resyncRequiredBySession: {},
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function pendingArtifacts() {
  let resolve!: (rows: SessionArtifact[]) => void;
  const promise = new Promise<SessionArtifact[]>((done) => { resolve = done; });
  return { promise, resolve };
}

function artifactRows(name: string) {
  return normalizeSessionArtifactRecords('http://127.0.0.1:8900', 'websocket:chat-progress', [{ path: name }]);
}

describe("ConversationWorkbench progress activity", () => {
  it("opens the exact historical role without a local team binding", () => {
    useTurnPlanStore.setState({ planByConversation: { 'chat-progress': {
      id: 'plan-byd', turn_id: 'turn-byd', kind: 'workflow', owner: 'expert_team:asset-research-team',
      policy: 'required', execution: 'staged', status: 'completed', revision: 195,
      active_step_ids: [], team_id: 'asset-research-team', team_run_id: '04db8b3226fd',
      steps: [{ id: 'risk-assessor', title: '风险评估师 · 李录视角', status: 'completed', warning: '该角色结果已降级' }],
    } } });
    const view = renderWorkbench(false);
    const supplement = view.querySelector<HTMLButtonElement>('button[title="Add materials"]');
    expect(supplement).not.toBeNull();
    act(() => supplement!.click());
    expect(useExpertTeamRevisionStore.getState().selection).toEqual({
      chatId: 'chat-progress', runId: '04db8b3226fd', roleId: 'risk-assessor',
    });
    expect(view.querySelector('button[title="Retry this role"]')).toBeNull();
  });

  it("renders only progress and artifacts in the pinned summary", () => {
    const view = renderWorkbench();

    expect(view.querySelector('[data-conversation-summary]')).not.toBeNull();
    expect(view.querySelector('[data-testid="conversation-details-loading"]')).not.toBeNull();
    expect(view.querySelectorAll('[data-summary-section]')).toHaveLength(2);
    expect(view.querySelector('[data-summary-section="progress"]')).not.toBeNull();
    expect(view.querySelector('[data-summary-section="artifacts"]')).not.toBeNull();
    expect(view.textContent).not.toContain("Session workbench");
    expect(view.textContent).not.toContain("Browser");
  });

  it("silently refreshes when reopening the same conversation summary", () => {
    const view = renderWorkbench(false);

    expect(vi.mocked(fetchSessionArtifacts)).toHaveBeenCalledTimes(1);
    expect(view.querySelector('[data-testid="conversation-details-loading"]')).toBeNull();
    expect(view.querySelector('[data-conversation-summary]')?.getAttribute("aria-busy")).toBe("false");
  });

  it("shows a generic planning state instead of tool steps before a plan arrives", () => {
    useConversationWorkbenchStore.setState((state) => ({
      progressByConversation: {
        ...state.progressByConversation,
        "chat-progress": {
          source: "empty",
          isActive: true,
          steps: [],
        },
      },
    }));

    const view = renderWorkbench();

    expect(view.textContent).toContain("Preparing the task plan");
    expect(view.textContent).not.toContain("Convert to PDF");
  });

  it("does not keep an inactive residual running step spinning", () => {
    const view = renderWorkbench();
    const progressRow = [...view.querySelectorAll("li")].find(
      (row) => row.textContent?.includes("Convert to PDF"),
    );

    expect(view.textContent).not.toContain("Running");
    expect(progressRow?.querySelector(".animate-spin")).toBeNull();
  });

  it("shows the active plan state without turning it into a loading spinner", () => {
    useConversationWorkbenchStore.setState((state) => ({
      progressByConversation: {
        ...state.progressByConversation,
        "chat-progress": {
          ...state.progressByConversation["chat-progress"],
          isActive: true,
        },
      },
    }));

    const view = renderWorkbench();
    const progressRow = [...view.querySelectorAll("li")].find(
      (row) => row.textContent?.includes("Convert to PDF"),
    );
    expect(view.textContent).toContain("Running");
    expect(progressRow?.querySelector(".animate-spin")).toBeNull();
    expect(progressRow?.querySelector(".rounded-full")).not.toBeNull();
  });

  it("does not issue a duplicate initial artifact request for an existing revision", () => {
    useConversationWorkbenchStore.setState((state) => ({
      artifactRevisionByConversation: {
        ...state.artifactRevisionByConversation,
        "chat-progress": 4,
      },
    }));

    renderWorkbench();

    expect(vi.mocked(fetchSessionArtifacts)).toHaveBeenCalledTimes(1);
  });

  it("refreshes artifacts with canonical identity without replacing thread history or plan", () => {
    const resource: ThreadResource = {
      schema_version: 3,
      project_id: "project-progress",
      session_id: "session-progress",
      session_key: "websocket:chat-progress",
      last_event_seq: 1,
      snapshot_revision: 1,
      runtime_snapshot_revision: 1,
      runtime_epoch: "epoch-progress",
      thread_status: { type: "idle" },
      active_turn: null,
      latest_turn: null,
      messages: [],
      plan: null,
      artifact_revision: 0,
      artifacts: [],
      from_event_seq: 0,
      to_event_seq: 1,
      events: [],
      has_more: false,
      resync_required: false,
    };
    useThreadResourceStore.setState({
      resourcesBySession: { "websocket:chat-progress": resource },
      resyncRequiredBySession: {},
    });

    const view = renderWorkbench();

    expect(fetchThreadResource).not.toHaveBeenCalled();
    expect(fetchSessionArtifacts).toHaveBeenCalledWith(
      expect.any(String), 'websocket:chat-progress', expect.stringMatching(/^http/), null,
      { projectId: 'project-progress', sessionId: 'session-progress' },
    );
    expect(useThreadResourceStore.getState().resourcesBySession['websocket:chat-progress']).toBe(resource);
    expect(view.querySelector('[data-conversation-summary]')?.getAttribute("aria-busy")).toBe("true");
    expect(view.querySelector('[data-testid="conversation-details-loading"]')).not.toBeNull();
  });

  it("does not keep artifact polling alive after the canonical plan is terminal", async () => {
    vi.useFakeTimers();
    try {
      useChatStore.getState().setConversationStatus("chat-progress", "running");
      useTurnPlanStore.setState({
        currentTurnByConversation: { "chat-progress": "turn-1" },
        planByConversation: {
          "chat-progress": {
            id: "plan:turn-1",
            turn_id: "turn-1",
            kind: "workflow",
            owner: "expert_team:asset-research-team",
            policy: "required",
            execution: "staged",
            status: "completed",
            revision: 7,
            active_step_ids: [],
            steps: [{
              id: "report-audit",
              title: "Report audit and delivery",
              status: "completed",
            }],
          },
        },
      });

      vi.mocked(fetchSessionArtifacts).mockResolvedValue([]);
      await act(async () => { renderWorkbench(); });
      act(() => vi.advanceTimersByTime(6_000));

      expect(vi.mocked(fetchSessionArtifacts)).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips overlapping polls and coalesces artifact events into one trailing refresh", async () => {
    vi.useFakeTimers();
    useChatStore.getState().setConversationStatus('chat-progress', 'running');
    const pending = pendingArtifacts();
    vi.mocked(fetchSessionArtifacts).mockReturnValueOnce(pending.promise).mockResolvedValue([]);
    renderWorkbench();
    act(() => vi.advanceTimersByTime(15_000));
    expect(fetchSessionArtifacts).toHaveBeenCalledTimes(1);
    for (let revision = 1; revision <= 3; revision += 1) {
      act(() => useConversationWorkbenchStore.setState({
        artifactRevisionByConversation: { 'chat-progress': revision },
      }));
    }
    expect(fetchSessionArtifacts).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve([]));
    expect(fetchSessionArtifacts).toHaveBeenCalledTimes(2);
    expect(container?.querySelector('[data-conversation-summary]')?.getAttribute('aria-busy')).toBe('false');
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(fetchSessionArtifacts).toHaveBeenCalledTimes(3);
  });

  it("keeps unchanged artifact polls silent but displays changed file metadata", async () => {
    vi.useFakeTimers();
    useChatStore.getState().setConversationStatus('chat-progress', 'running');
    vi.mocked(fetchSessionArtifacts).mockImplementation(async () => artifactRows('report.html'));
    await act(async () => { renderWorkbench(false); });
    const changed = vi.fn();
    const observer = new MutationObserver(changed);
    observer.observe(container!, { subtree: true, childList: true, characterData: true, attributes: true });
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(fetchSessionArtifacts).toHaveBeenCalledTimes(2);
    expect(changed).not.toHaveBeenCalled();
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
    vi.mocked(fetchSessionArtifacts).mockResolvedValue(artifactRows('report.html').map((row) => ({ ...row, size: 9 })));
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(container?.textContent).toContain('9 B');
  });

  it("pauses polling while hidden, retains event refresh, and refreshes immediately on return", async () => {
    vi.useFakeTimers();
    useChatStore.getState().setConversationStatus('chat-progress', 'running');
    vi.mocked(fetchSessionArtifacts).mockResolvedValue([]);
    await act(async () => { renderWorkbench(); });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(fetchSessionArtifacts).toHaveBeenCalledTimes(1);
    await act(async () => useConversationWorkbenchStore.setState({
      artifactRevisionByConversation: { 'chat-progress': 1 },
    }));
    expect(fetchSessionArtifacts).toHaveBeenCalledTimes(2);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(fetchSessionArtifacts).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(fetchSessionArtifacts).toHaveBeenCalledTimes(4);
  });

  it("ignores stale responses after switching conversations", async () => {
    const first = pendingArtifacts();
    const second = pendingArtifacts();
    vi.mocked(fetchSessionArtifacts).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderWorkbench(false);
    act(() => useChatStore.setState((state) => ({
      activeConversationId: 'chat-next',
      conversations: {
        ...state.conversations,
        'chat-next': { ...state.conversations['chat-progress'], id: 'chat-next' },
      },
    })));
    await act(async () => second.resolve(artifactRows('current-report.html')));
    await act(async () => first.resolve(artifactRows('old-report.html')));
    expect(container?.textContent).toContain('current-report.html');
    expect(container?.textContent).not.toContain('old-report.html');
  });

  it("does not start queued refreshes after the workbench is unmounted", async () => {
    const pending = pendingArtifacts();
    vi.mocked(fetchSessionArtifacts).mockReturnValue(pending.promise);
    renderWorkbench();
    act(() => useConversationWorkbenchStore.setState({
      artifactRevisionByConversation: { 'chat-progress': 1 },
    }));
    act(() => root?.unmount());
    root = undefined;
    await act(async () => pending.resolve([]));
    expect(fetchSessionArtifacts).toHaveBeenCalledTimes(1);
  });

  it("keeps completed progress visible inside the pinned summary", () => {
    useTurnPlanStore.setState({
      currentTurnByConversation: { "chat-progress": "turn-1" },
      planByConversation: {
        "chat-progress": {
          id: "plan:turn-1",
          turn_id: "turn-1",
          kind: "workflow",
          owner: "agent",
          policy: "required",
          execution: "staged",
          status: "completed",
          revision: 2,
          active_step_ids: [],
          steps: [{
            id: "report-audit",
            title: "Report audit and delivery",
            status: "completed",
          }],
        },
      },
    });

    const view = renderWorkbench();
    const progressSection = view.querySelector('section[aria-label="Progress"]');

    expect(progressSection?.textContent).toContain("Report audit and delivery");
    expect(progressSection?.textContent).toContain("1/1");
    expect(progressSection?.querySelector('button[aria-expanded]')).toBeNull();
  });

  it("keeps failed progress visible for diagnosis", () => {
    useTurnPlanStore.setState({
      currentTurnByConversation: { "chat-progress": "turn-2" },
      planByConversation: {
        "chat-progress": {
          id: "plan:turn-2",
          turn_id: "turn-2",
          kind: "workflow",
          owner: "agent",
          policy: "required",
          execution: "staged",
          status: "failed",
          revision: 1,
          active_step_ids: [],
          steps: [{
            id: "fetch-data",
            title: "Fetch market data",
            status: "failed",
          }],
        },
      },
    });

    const view = renderWorkbench();
    const progressSection = view.querySelector('section[aria-label="Progress"]');

    expect(progressSection?.textContent).toContain("Fetch market data");
  });
});
