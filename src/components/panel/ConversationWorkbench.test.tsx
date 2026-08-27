import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initLanguage } from "@/i18n";
import { fetchThreadResource } from "@/core/api";
import { fetchSessionArtifacts } from "@/core/sessionArtifacts";
import type { ThreadResource } from "@/core/types";
import { useChatStore } from "@/stores/chatStore";
import { useConversationWorkbenchStore } from "@/stores/conversationWorkbenchStore";
import { useThreadResourceStore } from "@/stores/threadResourceStore";
import { useTurnPlanStore } from "@/stores/turnPlanStore";
import ConversationWorkbench from "./ConversationWorkbench";

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
  initLanguage("en-US");
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
});

describe("ConversationWorkbench progress activity", () => {
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

  it("keeps loading active while a cached thread resource refreshes remotely", () => {
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

    expect(vi.mocked(fetchThreadResource)).toHaveBeenCalledTimes(1);
    expect(view.querySelector('[data-conversation-summary]')?.getAttribute("aria-busy")).toBe("true");
    expect(view.querySelector('[data-testid="conversation-details-loading"]')).not.toBeNull();
  });

  it("does not keep artifact polling alive after the canonical plan is terminal", () => {
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

      renderWorkbench();
      act(() => vi.advanceTimersByTime(6_000));

      expect(vi.mocked(fetchSessionArtifacts)).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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
