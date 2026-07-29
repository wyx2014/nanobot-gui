import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initLanguage } from "@/i18n";
import { fetchSessionArtifacts } from "@/core/sessionArtifacts";
import { useChatStore } from "@/stores/chatStore";
import { useConversationWorkbenchStore } from "@/stores/conversationWorkbenchStore";
import { useTurnPlanStore } from "@/stores/turnPlanStore";
import ConversationWorkbench from "./ConversationWorkbench";

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

function renderWorkbench() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<ConversationWorkbench />));
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
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe("ConversationWorkbench progress activity", () => {
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

  it("collapses completed progress and lets the user expand it again", () => {
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
          status: "running",
          revision: 1,
          active_step_ids: ["report-audit"],
          steps: [{
            id: "report-audit",
            title: "Report audit and delivery",
            status: "inProgress",
          }],
        },
      },
    });

    const view = renderWorkbench();
    const progressSection = view.querySelector('section[aria-label="Progress"]');
    const toggle = progressSection?.querySelector("button");

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(progressSection?.textContent).toContain("Report audit and delivery");

    act(() => {
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
    });

    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(progressSection?.textContent).not.toContain("Report audit and delivery");

    act(() => toggle?.click());

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(progressSection?.textContent).toContain("Report audit and delivery");
  });

  it("keeps failed progress expanded for diagnosis", () => {
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
    const toggle = progressSection?.querySelector("button");

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(progressSection?.textContent).toContain("Fetch market data");
  });
});
