import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { getNanobotClient } from "@/core/nanobotClient";
import { resolveArtifactUrl } from "@/core/artifacts";
import {
  mergeToolProgressEvents,
  mergeUniqueToolTraceLines,
  normalizeToolProgressEvents,
  toolTraceLinesFromEvents,
} from "@/core/nanobot/toolTraceMerge";
import type { StreamError } from "@/core/nanobot-client";
import type {
  InboundEvent,
  ExpertTeamBinding,
  UIInteractivePromptAnswer,
  OutboundCliAppMention,
  OutboundImageGeneration,
  OutboundMcpPresetMention,
  OutboundMedia,
  OutboundSkillScope,
  GoalStateWsPayload,
  ToolProgressEvent,
  TaskProgressStep,
  TurnPlanResource,
  UIImage,
  UIFileEdit,
  UIMediaAttachment,
  UIMessage,
  WorkspaceScopePayload,
} from "@/core/types";
import { useTurnPlanStore } from '@/stores/turnPlanStore';
import { useThreadResourceStore } from '@/stores/threadResourceStore';
import { useBrowserStore } from '@/stores/browserStore';
import { normalizeTurnPlan, planFromAgentUI } from '@/core/nanobot/planViewModel';
import {
  initialStreamProtocolState,
  streamProtocolReducer,
} from '@/core/nanobot/streamProtocol';

interface StreamBuffer {
  /** ID of the assistant message currently receiving deltas (cleared on ``stream_end``). */
  messageId: string;
  streamId?: string;
  turnId?: string;
}

interface ActiveAssistantCursor {
  id: string;
  index: number;
}

type PendingStreamEvent =
  | { kind: "delta"; text: string; streamId?: string; turnId?: string }
  | { kind: "reasoning"; text: string; turnId?: string }
  | {
      kind: "narration";
      text: string;
      streamId?: string;
      replacesStreamId?: string;
      turnId?: string;
    };

interface AnswerStreamIdentity {
  streamId?: string;
  turnId?: string;
}

function inboundStringField(event: InboundEvent, key: string): string | undefined {
  const value = (event as InboundEvent & Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function inboundTurnId(event: InboundEvent): string | undefined {
  const direct = inboundStringField(event, "turn_id");
  if (direct) return direct;
  if (event.event === "turn_started" || event.event === "turn_completed") {
    return event.turn.id;
  }
  return undefined;
}

function taskProgressField(
  agentUI: UIMessage["agentUI"],
  field: "plan_id" | "team_run_id" | "turn_id",
): string | undefined {
  if (agentUI?.kind !== "task_progress") return undefined;
  const value = agentUI[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Consecutive revisions of one plan are state updates, not timeline rows. */
function isSameTaskProgressPlan(
  previous: UIMessage["agentUI"],
  incoming: UIMessage["agentUI"],
): boolean {
  if (
    previous?.kind !== "task_progress"
    || incoming?.kind !== "task_progress"
  ) {
    return false;
  }
  for (const field of ["plan_id", "team_run_id", "turn_id"] as const) {
    const previousValue = taskProgressField(previous, field);
    const incomingValue = taskProgressField(incoming, field);
    if (previousValue && incomingValue) return previousValue === incomingValue;
  }
  const previousSteps = Array.isArray(previous.steps)
    ? previous.steps.map((step) => step.id).join("\u0000")
    : "";
  const incomingSteps = Array.isArray(incoming.steps)
    ? incoming.steps.map((step) => step.id).join("\u0000")
    : "";
  return !previousSteps || !incomingSteps || previousSteps === incomingSteps;
}

function sameTurn(message: UIMessage, turnId?: string): boolean {
  return !turnId || !message.turnId || message.turnId === turnId;
}

const FILE_EDIT_TOOL_NAMES = new Set(["write_file", "edit_file", "apply_patch"]);

function applyTurnPlanResource(chatId: string, plan: TurnPlanResource): void {
  useTurnPlanStore.getState().applyPlan(chatId, plan);
  useThreadResourceStore.getState().applyPlanResource(chatId, plan);
}
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg", ".tif", ".tiff"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv", ".3gp"]);

function extensionOf(value?: string): string {
  if (!value) return "";
  const clean = value.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  const dot = clean.lastIndexOf(".");
  return dot < 0 ? "" : clean.slice(dot);
}

function toMediaAttachment(media: {
  id?: string;
  url?: string;
  download_url?: string;
  local_path?: string;
  name?: string;
  kind?: UIMediaAttachment["kind"];
  mime_type?: string;
  size?: number;
}): UIMediaAttachment {
  const url = resolveArtifactUrl(media.url ?? "");
  const ext = extensionOf(media.name) || extensionOf(media.url);
  const kind = url.startsWith("data:image/") || IMAGE_EXTENSIONS.has(ext)
    ? "image"
    : url.startsWith("data:video/") || VIDEO_EXTENSIONS.has(ext)
      ? "video"
      : media.kind ?? "file";
  return {
    kind,
    id: media.id,
    url: url || undefined,
    download_url: media.download_url ? resolveArtifactUrl(media.download_url) : undefined,
    local_path: media.local_path,
    name: media.name,
    mime_type: media.mime_type,
    size: media.size,
  };
}

/** Find a still-open streamed assistant turn. Closed stream segments stay visible
 * as streaming until ``turn_end`` for visual continuity, but they must not
 * receive later delta segments. */
function findStreamingAssistantIndex(
  prev: UIMessage[],
  closedStreamIds: ReadonlySet<string>,
  turnId?: string,
): number | null {
  for (let i = prev.length - 1; i >= 0; i -= 1) {
    const m = prev[i];
    if (m.kind === "trace") continue;
    if (
      m.role === "assistant"
      && m.isStreaming
      && !closedStreamIds.has(m.id)
      && sameTurn(m, turnId)
    ) return i;
    if (m.role === "user") break;
  }
  return null;
}

function runtimeSnapshotForClient(
  client: ReturnType<typeof getNanobotClient> | null,
  chatId: string | null,
) {
  if (!client || !chatId) return undefined;
  const resolver = (
    client as ReturnType<typeof getNanobotClient> & {
      getRuntimeSnapshot?: ReturnType<typeof getNanobotClient>["getRuntimeSnapshot"];
    }
  ).getRuntimeSnapshot;
  return typeof resolver === "function"
    ? resolver.call(client, chatId)
    : undefined;
}

/**
 * Append a reasoning chunk to the last open reasoning stream in ``prev``.
 *
 * Lookup rule: reasoning can only extend the current reasoning placeholder.
 * Once ordinary answer text has appeared, the next reasoning chunk starts a
 * fresh Thought block so streamed output stays in arrival order:
 * Thought -> answer -> Thought -> answer.
 */
function attachReasoningChunk(
  prev: UIMessage[],
  chunk: string,
  segments?: {
    ensure: () => string;
    turnId?: string;
  },
): UIMessage[] {
  const receivedAt = Date.now();
  for (let i = prev.length - 1; i >= 0; i -= 1) {
    const candidate = prev[i];
    // A user turn is a hard boundary: reasoning after it belongs to the new
    // assistant turn, never to an earlier assistant reply.
    if (candidate.role === "user") break;
    // A trace row (e.g. Used tools) is also a phase boundary. Reasoning after
    // tools belongs to the next assistant iteration, not the assistant turn
    // that produced those tool calls.
    if (candidate.kind === "trace") break;
    if (candidate.role !== "assistant") continue;
    const activitySegmentId = candidate.activitySegmentId ?? segments?.ensure();
    const hasAnswer = candidate.content.length > 0;
    if (hasAnswer) break;
    if (
      candidate.reasoningStreaming
      || candidate.reasoning !== undefined
      || candidate.isStreaming
    ) {
      const merged: UIMessage = {
        ...candidate,
        reasoning: (candidate.reasoning ?? "") + chunk,
        reasoningStreaming: true,
        reasoningStartedAt: candidate.reasoningStartedAt ?? receivedAt,
        reasoningCompletedAt: undefined,
        reasoningDurationMs: undefined,
        ...(segments?.turnId ? { turnId: segments.turnId } : {}),
        ...(activitySegmentId ? { activitySegmentId } : {}),
      };
      return [...prev.slice(0, i), merged, ...prev.slice(i + 1)];
    }
    break;
  }
  const activitySegmentId = segments?.ensure();
  return [
    ...prev,
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      isStreaming: true,
      reasoning: chunk,
      reasoningStreaming: true,
      reasoningStartedAt: receivedAt,
      ...(segments?.turnId ? { turnId: segments.turnId } : {}),
      ...(activitySegmentId ? { activitySegmentId } : {}),
      createdAt: Date.now(),
    },
  ];
}

/**
 * Find the most recent assistant placeholder that an incoming answer
 * delta should adopt instead of spawning a parallel row. We look for an
 * empty-content assistant turn that is still marked ``isStreaming`` —
 * typically created earlier by ``reasoning_delta``. Anything else means
 * the model already produced an answer in a previous turn, so the new
 * delta belongs in a fresh row.
 */
function findActiveAssistantPlaceholderIndex(
  prev: UIMessage[],
  turnId?: string,
): number | null {
  const last = prev[prev.length - 1];
  if (!last) return null;
  if (last.role !== "assistant" || last.kind === "trace") return null;
  if (last.content.length > 0) return null;
  if (!last.isStreaming) return null;
  if (!sameTurn(last, turnId)) return null;
  return prev.length - 1;
}

function replaceMessageAt(prev: UIMessage[], index: number, message: UIMessage): UIMessage[] {
  const next = prev.slice();
  next[index] = message;
  return next;
}

/**
 * Close the active reasoning stream segment, if any. Idempotent: a
 * ``reasoning_end`` with no preceding deltas is a harmless no-op.
 */
export function closeReasoningStream(
  prev: UIMessage[],
  completedAt: number = Date.now(),
): UIMessage[] {
  for (let i = prev.length - 1; i >= 0; i -= 1) {
    const candidate = prev[i];
    if (!candidate.reasoningStreaming) continue;
    const startedAt = candidate.reasoningStartedAt ?? candidate.createdAt;
    const merged: UIMessage = {
      ...candidate,
      reasoningStreaming: false,
      reasoningStartedAt: startedAt,
      reasoningCompletedAt: completedAt,
      reasoningDurationMs: Math.max(0, completedAt - startedAt),
    };
    return [...prev.slice(0, i), merged, ...prev.slice(i + 1)];
  }
  return prev;
}

/**
 * Append public action narration to its own trace row.
 *
 * Narration is intentionally not stored in ``content``: conversational
 * message bodies are reserved for the final answer, while this field is safe
 * to render verbatim inside the activity timeline.
 */
export function attachNarrationChunk(
  prev: UIMessage[],
  chunk: string,
  options?: {
    ensure?: () => string;
    streamId?: string;
    replacesStreamId?: string;
    turnId?: string;
  },
): UIMessage[] {
  if (options?.replacesStreamId) {
    let replacementIndex = prev.findIndex((message) => (
      message.kind === "trace"
      && (
        message.streamId === options.replacesStreamId
        || (
          options.streamId !== undefined
          && message.narrationStreamId === options.streamId
        )
      )
    ));
    if (replacementIndex < 0) {
      replacementIndex = prev.findIndex((message) => (
        message.streamId === options.replacesStreamId
      ));
    }
    if (replacementIndex >= 0) {
      const replacement = prev[replacementIndex];
      const continuesSameNarration = !!(
        options.streamId
        && replacement.narrationStreamId === options.streamId
        && replacement.narrationStreaming
      );
      return replaceMessageAt(prev, replacementIndex, {
        ...replacement,
        role: "tool",
        kind: "trace",
        content: "",
        narration: continuesSameNarration
          ? (replacement.narration ?? "") + chunk
          : chunk,
        narrationStreaming: true,
        isStreaming: true,
        narrationStreamId: options.streamId,
        ...(options.turnId ? { turnId: options.turnId } : {}),
      });
    }
  }
  const last = prev[prev.length - 1];
  if (
    last?.kind === "trace"
    && last.narrationStreaming
    && (
      !options?.streamId
      || !last.narrationStreamId
      || last.narrationStreamId === options.streamId
    )
  ) {
    return replaceMessageAt(prev, prev.length - 1, {
      ...last,
      narration: (last.narration ?? "") + chunk,
      isStreaming: true,
      narrationStreaming: true,
      narrationStreamId: options?.streamId ?? last.narrationStreamId,
      ...(options?.turnId ? { turnId: options.turnId } : {}),
    });
  }
  const activitySegmentId = options?.ensure?.();
  return [
    ...prev,
    {
      id: crypto.randomUUID(),
      role: "tool",
      kind: "trace",
      content: "",
      narration: chunk,
      narrationStreaming: true,
      narrationStreamId: options?.streamId,
      ...(options?.turnId ? { turnId: options.turnId } : {}),
      isStreaming: true,
      ...(activitySegmentId ? { activitySegmentId } : {}),
      createdAt: Date.now(),
    },
  ];
}

/** Close the currently streaming public narration row, if present. */
export function closeNarrationStream(
  prev: UIMessage[],
  streamId?: string,
): UIMessage[] {
  for (let i = prev.length - 1; i >= 0; i -= 1) {
    const candidate = prev[i];
    if (candidate.role === "user") break;
    if (!candidate.narrationStreaming) continue;
    if (streamId && candidate.narrationStreamId && candidate.narrationStreamId !== streamId) {
      continue;
    }
    return replaceMessageAt(prev, i, {
      ...candidate,
      narrationStreaming: false,
      isStreaming: false,
    });
  }
  return prev;
}

/**
 * A gateway cannot always know whether streamed text is final until the model
 * finishes the segment. ``stream_end.resuming`` marks a segment that is
 * followed by tools. Move it out of the answer body and into public Steps
 * narration without exposing any private reasoning attached to the same row.
 */
export function reclassifyAssistantStreamAsNarration(
  prev: UIMessage[],
  options?: {
    messageId?: string;
    streamId?: string;
    ensureActivitySegment?: () => string;
  },
): UIMessage[] {
  let index = options?.messageId
    ? prev.findIndex((message) => message.id === options.messageId)
    : options?.streamId
      ? prev.findIndex((message) => message.streamId === options.streamId)
      : -1;
  if (index < 0) {
    for (let i = prev.length - 1; i >= 0; i -= 1) {
      const candidate = prev[i];
      if (candidate.role === "user") break;
      if (
        candidate.role === "assistant"
        && candidate.kind !== "trace"
        && candidate.content.trim().length > 0
        && candidate.isStreaming
      ) {
        index = i;
        break;
      }
    }
  }
  if (index < 0) return prev;

  const candidate = prev[index];
  if (candidate.role !== "assistant" || candidate.kind === "trace") return prev;
  const narration = candidate.content.trim();
  if (!narration) return prev;
  const activitySegmentId =
    candidate.activitySegmentId ?? options?.ensureActivitySegment?.();
  const narrationRow: UIMessage = {
    id: candidate.id,
    role: "tool",
    kind: "trace",
    content: "",
    narration,
    narrationStreaming: false,
    streamId: options?.streamId ?? candidate.streamId,
    isStreaming: false,
    ...(activitySegmentId ? { activitySegmentId } : {}),
    createdAt: candidate.createdAt,
  };

  const hasPrivateReasoning =
    candidate.reasoning !== undefined || candidate.reasoningStreaming;
  if (!hasPrivateReasoning) {
    return replaceMessageAt(prev, index, narrationRow);
  }

  const reasoningRow: UIMessage = {
    ...candidate,
    content: "",
    isStreaming: false,
    reasoningStreaming: false,
    ...(activitySegmentId ? { activitySegmentId } : {}),
  };
  delete reasoningRow.streamId;
  return [
    ...prev.slice(0, index),
    reasoningRow,
    { ...narrationRow, id: `${candidate.id}-narration` },
    ...prev.slice(index + 1),
  ];
}

/**
 * Close every locally-open stream when a user interrupts a turn.  The gateway
 * remains the authority for elapsed time, so an interrupted placeholder must
 * never turn its age into a fictional completed-turn latency.
 */
export function finalizeInterruptedTurn(
  prev: UIMessage[],
  completedAt: number = Date.now(),
): UIMessage[] {
  return prev.map((message) => {
    const taskProgress = (
      message.agentUI?.kind === "task_progress"
      && Array.isArray(message.agentUI.steps)
    )
      ? message.agentUI as {
        kind: "task_progress";
        steps: TaskProgressStep[];
        note?: string;
        current_step_id?: string;
        [key: string]: unknown;
      }
      : undefined;
    const cancelledPlan = taskProgress
      ? {
        ...taskProgress,
        steps: taskProgress.steps.map((step) => (
          step.status === "running" || step.status === "pending"
            ? {
              ...step,
              status: "interrupted" as const,
              detail: step.detail ? `${step.detail}（已由用户终止）` : "已由用户终止",
            }
            : step
        )),
        status: "interrupted" as const,
        active_step_ids: [],
        current_step_id: undefined,
        note: "任务已由用户终止",
      }
      : undefined;
    const cancelledToolEvents = message.toolEvents?.map((event) => (
      event.phase === "start"
        ? { ...event, phase: "error", error: "已由用户终止", occurred_at: completedAt }
        : event
    ));
    const cancelledFileEdits = message.fileEdits?.map((edit) => (
      edit.status === "editing"
        ? { ...edit, status: "error" as const, phase: "error", error: "已由用户终止" }
        : edit
    ));
    const hasInterruptedWork = message.isStreaming
      || message.reasoningStreaming
      || message.narrationStreaming
      || taskProgress?.steps.some((step) => step.status === "running")
      || message.toolEvents?.some((event) => event.phase === "start")
      || message.fileEdits?.some((edit) => edit.status === "editing");
    if (!hasInterruptedWork) return message;
    return {
      ...message,
      isStreaming: false,
      reasoningStreaming: false,
      narrationStreaming: false,
      ...(cancelledPlan ? { agentUI: cancelledPlan } : {}),
      ...(cancelledToolEvents ? { toolEvents: cancelledToolEvents } : {}),
      ...(cancelledFileEdits ? { fileEdits: cancelledFileEdits } : {}),
    };
  });
}

function closeOpenStreams(prev: UIMessage[]): UIMessage[] {
  return prev.map((message) => (
    message.isStreaming || message.reasoningStreaming || message.narrationStreaming
      ? {
        ...message,
        isStreaming: false,
        reasoningStreaming: false,
        narrationStreaming: false,
      }
      : message
  ));
}

export function finalizeCompletedTurnProgress(prev: UIMessage[]): UIMessage[] {
  const turnStart = currentTurnStartIndex(prev);
  return prev.map((message, index) => {
    if (
      index < turnStart
      || message.agentUI?.kind !== "task_progress"
      || !Array.isArray(message.agentUI.steps)
    ) {
      return message;
    }
    const progress = message.agentUI as {
      kind: "task_progress";
      steps: TaskProgressStep[];
      current_step_id?: string;
      [key: string]: unknown;
    };
    return {
      ...message,
      agentUI: {
        ...progress,
        steps: progress.steps.map((step) => (
          step.status === "running"
            ? { ...step, status: "completed" as const }
            : step.status === "pending"
              ? { ...step, status: "skipped" as const }
              : step
        )),
        current_step_id: undefined,
      },
    };
  });
}

function currentTurnStartIndex(messages: UIMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return index + 1;
  }
  return 0;
}

/** A failed turn must stop animating without presenting unfinished work as
 * successful. Existing completed/error steps remain truthful; only the active
 * step is converted to an error and future pending steps remain pending. */
export function finalizeFailedTurnProgress(prev: UIMessage[]): UIMessage[] {
  const turnStart = currentTurnStartIndex(prev);
  return prev.map((message, index) => {
    if (
      index < turnStart
      || message.agentUI?.kind !== "task_progress"
      || !Array.isArray(message.agentUI.steps)
    ) {
      return message;
    }
    const progress = message.agentUI as {
      kind: "task_progress";
      steps: TaskProgressStep[];
      note?: string;
      current_step_id?: string;
      [key: string]: unknown;
    };
    const hasRunning = progress.steps.some((step) => step.status === "running");
    if (!hasRunning && progress.current_step_id === undefined) return message;
    return {
      ...message,
      agentUI: {
        ...progress,
        steps: progress.steps.map((step) => (
          step.status === "running"
            ? {
              ...step,
              status: "error" as const,
              detail: step.detail ? `${step.detail}（执行失败）` : "执行失败",
            }
            : step.status === "pending"
              ? { ...step, status: "skipped" as const }
              : step
        )),
        current_step_id: undefined,
      },
    };
  });
}

function isReasoningOnlyPlaceholder(message: UIMessage): boolean {
  return (
    message.role === "assistant"
    && message.kind !== "trace"
    && message.content.trim().length === 0
    && !!message.reasoning
    && !message.reasoningStreaming
    && !message.media?.length
  );
}

function isToolTrace(message: UIMessage | undefined): boolean {
  return message?.kind === "trace";
}

export function isNarrationStreamEnd(
  event: Extract<InboundEvent, { event: "stream_end" }>,
): boolean {
  return event.resuming === true || event.stream_kind === "narration";
}

function pruneReasoningOnlyPlaceholders(prev: UIMessage[]): UIMessage[] {
  return prev.filter((message, index) => {
    if (!isReasoningOnlyPlaceholder(message)) return true;
    // A reasoning-only assistant row immediately followed by tool traces is
    // the live equivalent of a persisted assistant tool-call message with
    // empty content, reasoning_content, and tool_calls. Keep it so live render
    // and history replay stay isomorphic.
    return isToolTrace(prev[index + 1]);
  });
}

function stampLastAssistantLatency(prev: UIMessage[], latencyMs: number): UIMessage[] {
  for (let i = prev.length - 1; i >= 0; i -= 1) {
    const m = prev[i];
    if (m.role === "assistant" && m.kind !== "trace") {
      const merged: UIMessage = { ...m, latencyMs, isStreaming: false };
      return [...prev.slice(0, i), merged, ...prev.slice(i + 1)];
    }
  }
  return prev;
}

function stampLastAssistantCompletedAt(prev: UIMessage[], completedAt: number): UIMessage[] {
  for (let i = prev.length - 1; i >= 0; i -= 1) {
    const m = prev[i];
    if (m.role === "assistant" && m.kind !== "trace") {
      const merged: UIMessage = { ...m, completedAt, isStreaming: false };
      return [...prev.slice(0, i), merged, ...prev.slice(i + 1)];
    }
  }
  return prev;
}

export function normalizeTurnUsage(
  usage: Extract<InboundEvent, { event: "turn_end" }>["usage"],
): UIMessage["usage"] | undefined {
  if (!usage) return undefined;
  const inputTokens = Math.max(
    0,
    Math.round(usage.prompt_tokens ?? usage.input_tokens ?? 0),
  );
  const outputTokens = Math.max(
    0,
    Math.round(usage.completion_tokens ?? usage.output_tokens ?? 0),
  );
  if (inputTokens === 0 && outputTokens === 0) return undefined;
  return { inputTokens, outputTokens };
}

export interface CurrentTurnUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  newTokens: number;
  estimated: boolean;
}

function normalizeCurrentTurnUsage(
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    estimated_tokens?: number;
    cached_tokens?: number;
    cache_read_input_tokens?: number;
    confirmed_new_tokens?: number;
    new_tokens?: number;
  } | undefined,
  estimated: boolean,
): CurrentTurnUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = Math.max(
    0,
    Math.round(usage.prompt_tokens ?? usage.input_tokens ?? 0),
  );
  const outputTokens = Math.max(
    0,
    Math.round(usage.completion_tokens ?? usage.output_tokens ?? 0),
  );
  const totalTokens = Math.max(
    inputTokens + outputTokens,
    Math.round(usage.total_tokens ?? 0),
  );
  if (totalTokens === 0) return undefined;
  const cachedTokens = Math.min(
    totalTokens,
    Math.max(
      0,
      Math.round(usage.cached_tokens ?? usage.cache_read_input_tokens ?? 0),
    ),
  );
  const providerNewTokens = totalTokens - cachedTokens;
  const liveNewTokens = Math.max(
    0,
    Math.round(
      usage.new_tokens
      ?? usage.confirmed_new_tokens
      ?? providerNewTokens,
    ),
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens,
    newTokens: estimated ? liveNewTokens : providerNewTokens,
    estimated: estimated || (usage.estimated_tokens ?? 0) > 0,
  };
}

export function keepTurnUsageMonotonic(
  previous: CurrentTurnUsage | undefined,
  next: CurrentTurnUsage | undefined,
): CurrentTurnUsage | undefined {
  if (!next || !previous || next.newTokens >= previous.newTokens) return next;
  return { ...next, newTokens: previous.newTokens };
}

function stampLastAssistantUsage(
  prev: UIMessage[],
  usage: NonNullable<UIMessage["usage"]>,
): UIMessage[] {
  for (let index = prev.length - 1; index >= 0; index -= 1) {
    const message = prev[index];
    if (message.role === "assistant" && message.kind !== "trace") {
      return [
        ...prev.slice(0, index),
        { ...message, usage },
        ...prev.slice(index + 1),
      ];
    }
  }
  return prev;
}

export function absorbCompleteAssistantMessage(
  prev: UIMessage[],
  message: Omit<UIMessage, "id" | "role" | "createdAt">,
  options?: {
    replaceStream?: boolean;
    streamId?: string;
    turnId?: string;
    eventId?: string;
  },
): UIMessage[] {
  if (options?.replaceStream) {
    let lastUserIndex = -1;
    for (let index = prev.length - 1; index >= 0; index -= 1) {
      if (prev[index].role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    const assistantIndexes: number[] = [];
    for (let index = lastUserIndex + 1; index < prev.length; index += 1) {
      const candidate = prev[index];
      if (candidate.role !== "assistant" || candidate.kind === "trace") continue;
      const sameStream = Boolean(
        options.streamId
        && candidate.streamId
        && candidate.streamId === options.streamId,
      );
      const sameTurnFallback = Boolean(
        !options.streamId
        && options.turnId
        && candidate.turnId === options.turnId
        && (
          candidate.isStreaming
          || candidate.content === message.content
          || (
            candidate.content.length > 0
            && message.content.endsWith(candidate.content)
          )
        ),
      );
      if (sameStream || sameTurnFallback) assistantIndexes.push(index);
    }

    if (assistantIndexes.length > 0) {
      const targetIndex = assistantIndexes[0];
      const candidate = prev[targetIndex];
      const duplicateIndexes = new Set(assistantIndexes.slice(1));
      return prev.flatMap((item, index) => {
        if (duplicateIndexes.has(index)) return [];
        if (index !== targetIndex) return [item];
        return [{
          ...candidate,
          ...message,
          id: candidate.id,
          role: "assistant" as const,
          createdAt: candidate.createdAt,
          isStreaming: false,
          reasoningStreaming: false,
          ...(options.streamId ? { streamId: options.streamId } : {}),
          ...(options.turnId ? { turnId: options.turnId } : {}),
          ...(options.eventId ? { eventId: options.eventId } : {}),
        }];
      });
    }
  }

  // A streamed reply can be followed by an authoritative ``message`` that
  // carries generated attachments. By then ``stream_end`` has closed the
  // active cursor, so merge into the latest assistant bubble in this user
  // turn. Exact-content matching repairs transcripts from older gateways
  // that did not emit ``replace_stream``.
  for (let index = prev.length - 1; index >= 0; index -= 1) {
    const candidate = prev[index];
    if (candidate.role === "user") break;
    if (candidate.role !== "assistant" || candidate.kind === "trace") continue;
    const exactStreamReplay = (
      candidate.isStreaming
      && candidate.content.length > 0
      && candidate.content === message.content
    );
    if (!options?.replaceStream && !exactStreamReplay) break;
    return replaceMessageAt(prev, index, {
      ...candidate,
      ...message,
      ...(options?.streamId ? { streamId: options.streamId } : {}),
      ...(options?.turnId ? { turnId: options.turnId } : {}),
      ...(options?.eventId ? { eventId: options.eventId } : {}),
      id: candidate.id,
      role: "assistant",
      createdAt: candidate.createdAt,
      isStreaming: false,
      reasoningStreaming: false,
    });
  }

  const last = prev[prev.length - 1];
  if (!last || !isReasoningOnlyPlaceholder(last)) {
    return [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        createdAt: Date.now(),
        ...message,
        ...(options?.streamId ? { streamId: options.streamId } : {}),
        ...(options?.turnId ? { turnId: options.turnId } : {}),
        ...(options?.eventId ? { eventId: options.eventId } : {}),
      },
    ];
  }
  return [
    ...prev.slice(0, -1),
    {
      ...last,
      ...message,
      ...(options?.streamId ? { streamId: options.streamId } : {}),
      ...(options?.turnId ? { turnId: options.turnId } : {}),
      ...(options?.eventId ? { eventId: options.eventId } : {}),
      isStreaming: false,
      reasoningStreaming: false,
    },
  ];
}

function fileEditKey(edit: Pick<UIFileEdit, "call_id" | "tool" | "path">): string {
  if (edit.call_id) return `${edit.call_id}|${edit.tool}`;
  return `${edit.tool}|${edit.path}`;
}

function toolEventFileEditKey(event: ToolProgressEvent): string | null {
  const fn = (event as { function?: { name?: unknown } }).function;
  const name = typeof event.name === "string"
    ? event.name
    : typeof fn?.name === "string"
      ? fn.name
      : "";
  const callId = typeof event.call_id === "string" ? event.call_id : "";
  if (!name || !callId || !FILE_EDIT_TOOL_NAMES.has(name)) return null;
  return `${callId}|${name}`;
}

function hasFileEditForToolEvent(messages: UIMessage[], event: ToolProgressEvent): boolean {
  const key = toolEventFileEditKey(event);
  if (!key) return false;
  return messages.some((message) =>
    message.fileEdits?.some((edit) => fileEditKey(edit) === key),
  );
}

function filterCoveredFileEditToolEvents(
  messages: UIMessage[],
  events: ToolProgressEvent[],
): ToolProgressEvent[] {
  if (events.length === 0) return events;
  return events.filter((event) => !hasFileEditForToolEvent(messages, event));
}

function stringifyToolError(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function workspaceAccessRequiredReason(events: ToolProgressEvent[]): string | null {
  const markers = [
    "outside the configured workspace",
    "outside allowed directory",
    "working_dir is outside",
    "working_dir could not be resolved",
    "path outside working dir",
    "path traversal detected",
  ];
  for (const event of events) {
    if (event.phase !== "error") continue;
    const text = stringifyToolError(event.error ?? event.result);
    const lowered = text.toLowerCase();
    if (markers.some((marker) => lowered.includes(marker))) {
      return text || "Tool access was blocked by the current workspace permission.";
    }
  }
  return null;
}

function stripCoveredFileEditToolHints(message: UIMessage, edits: UIFileEdit[]): UIMessage {
  const incomingKeys = new Set(edits.map(fileEditKey));
  const events = message.toolEvents ?? [];
  if (!events.length || incomingKeys.size === 0) return message;

  const removedTraceLines = new Set<string>();
  const keptEvents: ToolProgressEvent[] = [];
  let changed = false;
  for (const event of events) {
    const key = toolEventFileEditKey(event);
    if (key && incomingKeys.has(key)) {
      changed = true;
      for (const line of toolTraceLinesFromEvents([event])) {
        removedTraceLines.add(line);
      }
      continue;
    }
    keptEvents.push(event);
  }
  if (!changed) return message;

  const previousTraces = message.traces?.length
    ? message.traces
    : message.content
      ? [message.content]
      : [];
  const nextTraces = previousTraces.filter((line) => !removedTraceLines.has(line));
  return {
    ...message,
    traces: nextTraces,
    content: nextTraces[nextTraces.length - 1] ?? "",
    toolEvents: keptEvents.length ? keptEvents : undefined,
  };
}

function normalizeFileEdit(edit: UIFileEdit): UIFileEdit | null {
  if (!edit || !edit.tool || (!edit.path && !edit.pending)) return null;
  const inferredStatus =
    edit.phase === "error"
      ? "error"
      : edit.phase === "end"
        ? "done"
        : "editing";
  const normalized: UIFileEdit = {
    ...edit,
    call_id: edit.call_id || `${edit.tool}:${edit.path}`,
    added: Number.isFinite(edit.added) ? Math.max(0, Math.round(edit.added)) : 0,
    deleted: Number.isFinite(edit.deleted) ? Math.max(0, Math.round(edit.deleted)) : 0,
    status: edit.status === "error" || edit.status === "done" || edit.status === "editing"
      ? edit.status
      : inferredStatus,
  };
  if (edit.pending && !edit.path) normalized.pending = true;
  return normalized;
}

function mergeFileEdits(existing: UIFileEdit[] | undefined, incoming: UIFileEdit[]): UIFileEdit[] {
  const next = [...(existing ?? [])];
  const indexByKey = new Map(next.map((edit, index) => [fileEditKey(edit), index]));
  for (const raw of incoming) {
    const edit = normalizeFileEdit(raw);
    if (!edit) continue;
    const key = fileEditKey(edit);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, next.length);
      next.push(edit);
      continue;
    }
    const merged = { ...next[existingIndex], ...edit };
    if (edit.path && !edit.pending) delete merged.pending;
    next[existingIndex] = merged;
  }
  return next;
}

function findFileEditTraceIndex(
  prev: UIMessage[],
  segmentId: string | null,
  incoming: UIFileEdit[],
): number | null {
  const incomingKeys = new Set(incoming.map(fileEditKey));
  for (let i = prev.length - 1; i >= 0; i -= 1) {
    const candidate = prev[i];
    if (candidate.role === "user") break;
    if (candidate.kind !== "trace") continue;
    if (segmentId && candidate.activitySegmentId === segmentId) return i;
    for (const existing of candidate.fileEdits ?? []) {
      if (incomingKeys.has(fileEditKey(existing))) return i;
    }
    for (const event of candidate.toolEvents ?? []) {
      const key = toolEventFileEditKey(event);
      if (key && incomingKeys.has(key)) return i;
    }
  }
  return null;
}

/**
 * Subscribe to a chat by ID. Returns the in-memory message list for the chat,
 * a streaming flag, and a ``send`` function. Initial history must be seeded
 * separately (e.g. via ``fetchWebuiThread``) since the server only replays
 * live events.
 */
/** Payload passed to ``send`` when the user attaches one or more images.
 *
 * ``media`` is handed to the wire client verbatim; ``preview`` powers the
 * optimistic user bubble (blob URLs so the preview appears before the server
 * acks the frame). Keeping the two separate lets the bubble re-use the local
 * blob URL even after the server persists the file under a different name. */
export interface SendImage {
  media: OutboundMedia;
  preview: UIImage;
}

export interface SendOptions {
  imageGeneration?: OutboundImageGeneration;
  cliApps?: OutboundCliAppMention[];
  mcpPresets?: OutboundMcpPresetMention[];
  skillScope?: OutboundSkillScope;
  workspaceScope?: WorkspaceScopePayload | null;
  interactivePromptAnswer?: UIInteractivePromptAnswer;
  expertTeam?: ExpertTeamBinding;
}

function teamProgressMessageId(
  messages: UIMessage[],
  teamId: string,
  runId: string | undefined,
): string | undefined {
  const exactId = runId ? `team-run-${runId}` : undefined;
  if (exactId && messages.some((message) => message.id === exactId)) return exactId;

  // A gateway restart or an older context bridge can omit the run id on a
  // member update. The active team's stable id still identifies the progress
  // card, so prefer the newest matching card instead of silently dropping a
  // real status update.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const ui = message.agentUI;
    if (ui?.kind === "task_progress" && ui.team_id === teamId) return message.id;
  }
  return undefined;
}

type TeamMemberUpdatedEvent = Extract<InboundEvent, { event: "team_member_updated" }>;

function workflowPlanMatchesMemberEvent(
  plan: TurnPlanResource,
  event: TeamMemberUpdatedEvent,
): boolean {
  if (plan.kind !== "workflow") return false;
  if (plan.team_run_id && plan.team_run_id !== event.run_id) return false;
  if (plan.team_id && plan.team_id !== event.team_id) return false;
  return true;
}

function teamMemberStepStatus(
  status: TeamMemberUpdatedEvent["member"]["status"],
): TaskProgressStep["status"] {
  if (status === "running") return "running";
  if (status === "pending") return "pending";
  // A failed or cancelled member is terminal for orchestration purposes. The
  // visible title/warning keeps the degraded outcome explicit while allowing
  // the Team Lead to continue with the remaining members.
  return "completed";
}

function teamMemberStepTitle(
  title: string,
  status: TeamMemberUpdatedEvent["member"]["status"],
): string {
  const base = title.replace(/（已降级）$|（已停止）$/, "");
  if (status === "failed") return `${base}（已降级）`;
  if (status === "cancelled") return `${base}（已停止）`;
  return base;
}

function overlayTeamMemberUpdateOnPlan(
  plan: TurnPlanResource,
  event: TeamMemberUpdatedEvent,
): TurnPlanResource {
  const nextStatus = teamMemberStepStatus(event.member.status);
  const steps = plan.steps.map((step) => (
    step.id === event.member.id
      ? {
          ...step,
          title: teamMemberStepTitle(step.title, event.member.status),
          detail: event.member.activity || step.detail,
          status: nextStatus,
          ...(
            event.member.status === "failed" || event.member.status === "cancelled"
              ? { warning: event.member.activity || step.warning }
              : {}
          ),
        }
      : step
  ));
  const activeStepIds = steps
    .filter((step) => step.status === "running" || step.status === "inProgress")
    .map((step) => step.id);
  return {
    ...plan,
    steps,
    active_step_ids: activeStepIds,
    current_step_id: activeStepIds.length === 1 ? activeStepIds[0] : null,
    note: event.member.status === "failed"
      ? "部分维度已降级，团队将继续完成报告"
      : event.member.status === "cancelled"
        ? "主任务已停止，后台专家和并发槽位已释放"
        : plan.note,
  };
}

function planAgentUI(plan: TurnPlanResource) {
  return {
    kind: 'task_progress' as const,
    plan_id: plan.id,
    turn_id: plan.turn_id,
    plan_kind: plan.kind,
    owner: plan.owner,
    policy: plan.policy,
    execution: plan.execution,
    status: plan.status,
    revision: plan.revision,
    active_step_ids: plan.active_step_ids,
    steps: plan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      ...(step.detail ? { detail: step.detail } : {}),
      status: (
        step.status === 'inProgress'
          ? 'running'
          : step.status === 'failed'
            ? 'error'
            : step.status === 'cancelled'
              ? 'interrupted'
              : step.status
      ) as TaskProgressStep['status'],
    })),
    ...(plan.note ? { note: plan.note } : {}),
    ...(plan.current_step_id ? { current_step_id: plan.current_step_id } : {}),
    ...(plan.team_id ? { team_id: plan.team_id } : {}),
    ...(plan.team_run_id ? { team_run_id: plan.team_run_id } : {}),
  };
}

function applyPlanToMessages(
  previous: UIMessage[],
  rawPlan: TurnPlanResource,
): UIMessage[] {
  const plan = normalizeTurnPlan(rawPlan);
  const agentUI = planAgentUI(plan);
  let targetIndex = -1;
  for (let index = previous.length - 1; index >= 0; index -= 1) {
    const ui = previous[index].agentUI;
    if (ui?.kind !== 'task_progress') continue;
    if (
      ui.plan_id === plan.id
      || ui.turn_id === plan.turn_id
      || (plan.team_run_id && ui.team_run_id === plan.team_run_id)
    ) {
      targetIndex = index;
      break;
    }
  }
  if (targetIndex >= 0) {
    return previous.map((message, index) => (
      index === targetIndex ? { ...message, agentUI } : message
    ));
  }
  return [
    ...previous,
    {
      id: `turn-plan-${plan.id}`,
      role: 'tool',
      kind: 'trace',
      content: plan.note || '',
      traces: plan.note ? [plan.note] : [],
      agentUI,
      createdAt: Date.now(),
    },
  ];
}

export function useNanobotStream(
  chatId: string | null,
  initialMessages: UIMessage[] = [],
  hasPendingToolCalls = false,
  onTurnEnd?: () => void,
  onArtifactCreated?: () => void,
): {
  messages: UIMessage[];
  /** Conversation that owns the returned message projection.
   *
   * This is temporarily ``null`` while a chat switch is being committed, so
   * consumers never reinterpret the previous chat's messages as belonging to
   * the newly selected chat. */
  messageConversationId: string | null;
  isStreaming: boolean;
  /** Stop was requested and the gateway has not confirmed the terminal turn yet. */
  isStopping: boolean;
  /** Unix epoch seconds when the current user turn started (WebSocket ``goal_status``). */
  runStartedAt: number | null;
  /** Live usage for the active turn; estimates are replaced by provider usage. */
  turnUsage: CurrentTurnUsage | undefined;
  /** Latest sustained goal for this ``chatId`` (``goal_state`` WS events). */
  goalState: GoalStateWsPayload | undefined;
  send: (content: string, images?: SendImage[], options?: SendOptions) => boolean;
  stop: () => void;
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  /** Latest transport-level fault raised since the last ``dismissStreamError``.
   * ``null`` when there is nothing to show. */
  streamError: StreamError | null;
  /** Clear the current ``streamError`` (e.g. after the user dismisses the
   * notification or starts a fresh action). */
  dismissStreamError: () => void;
} {
  let client: ReturnType<typeof getNanobotClient> | null = null;
  try {
    client = getNanobotClient();
  } catch {
    client = null;
  }
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [turnUsage, setTurnUsage] = useState<CurrentTurnUsage>();
  const [messageConversationId, setMessageConversationId] = useState<string | null>(chatId);
  const visibleMessages = messageConversationId === chatId ? messages : [];
  /** Runtime Snapshot is authoritative after reconnect. Historical trace rows
   * and pending-looking tool records must not resurrect a completed turn. */
  const initialRuntimeSnapshot = runtimeSnapshotForClient(client, chatId);
  const initialStreaming = initialRuntimeSnapshot
    ? initialRuntimeSnapshot.thread_status.type === "active"
    : hasPendingToolCalls;
  const [protocol, dispatchProtocol] = useReducer(streamProtocolReducer, {
    ...initialStreamProtocolState,
    isStreaming: initialStreaming,
  });
  const { isStreaming, isStopping, runStartedAt, goalState, streamError } = protocol;
  const setIsStreaming = useCallback((value: boolean) => dispatchProtocol({ type: 'streaming', value }), []);
  const setIsStopping = useCallback((value: boolean) => dispatchProtocol({ type: 'stopping', value }), []);
  const setGoalState = useCallback((value: GoalStateWsPayload | undefined) => dispatchProtocol({ type: 'goal_state', value }), []);
  const setRunStartedAt = useCallback((value: number | null) => dispatchProtocol({ type: 'goal_status', status: value === null ? 'idle' : 'running', ...(value === null ? {} : { startedAt: value }) }), []);
  const setStreamError = useCallback((value: StreamError | null) => dispatchProtocol({ type: 'error', value }), []);
  const buffer = useRef<StreamBuffer | null>(null);
  const activeAssistantRef = useRef<ActiveAssistantCursor | null>(null);
  const activeTurnIdRef = useRef<string | null>(initialRuntimeSnapshot?.active_turn?.id ?? null);
  /** Keep the answer identity beyond ``stream_end``. The final authoritative
   * message can arrive after the active cursor is closed and must still replace
   * every buffered fragment from the same stream. */
  const lastAnswerStreamRef = useRef<AnswerStreamIdentity | null>(null);
  const closedAssistantStreamIdsRef = useRef<Set<string>>(new Set());
  const activitySegmentRef = useRef<string | null>(null);
  const fileEditSegmentRef = useRef<string | null>(null);
  const activitySegmentCounterRef = useRef(0);
  const pendingStreamEventsRef = useRef<PendingStreamEvent[]>([]);
  const streamFrameRef = useRef<number | null>(null);
  const suppressStreamUntilTurnEndRef = useRef(false);
  const lifecycleTerminalHandledRef = useRef(false);
  /** Timer that defers ``isStreaming = false`` after ``stream_end``.
   *
   * When the model finishes a text segment and calls a tool, the server
   * sends ``stream_end`` but the agent is still "thinking" while the tool
   * executes.  By deferring the flag reset by a short window (1 s) we keep
   * the loading spinner alive across tool-call boundaries without needing
   * backend changes. */
  const streamEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!client) return;
    return client.onError((err) => {
      const errorChatId = 'chatId' in err ? err.chatId : undefined;
      if (errorChatId && errorChatId !== chatId) return;
      setStreamError(err);
    });
  }, [chatId, client, setStreamError]);

  const dismissStreamError = useCallback(() => setStreamError(null), [setStreamError]);

  const clearPendingStreamWork = useCallback(() => {
    if (streamFrameRef.current !== null) {
      window.cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
    }
    pendingStreamEventsRef.current = [];
  }, []);

  const createActivitySegmentId = useCallback((activate = true) => {
    activitySegmentCounterRef.current += 1;
    const id = `activity-${activitySegmentCounterRef.current}`;
    if (activate) activitySegmentRef.current = id;
    return id;
  }, []);

  const freshActivitySegmentId = useCallback(
    () => createActivitySegmentId(true),
    [createActivitySegmentId],
  );

  const detachedActivitySegmentId = useCallback(
    () => createActivitySegmentId(false),
    [createActivitySegmentId],
  );

  const ensureActivitySegmentId = useCallback(() => {
    if (activitySegmentRef.current) return activitySegmentRef.current;
    return freshActivitySegmentId();
  }, [freshActivitySegmentId]);

  const clearActivitySegment = useCallback(() => {
    activitySegmentRef.current = null;
    fileEditSegmentRef.current = null;
  }, []);

  const closeActiveAssistantStream = useCallback(() => {
    const closedStreamId = buffer.current?.messageId ?? activeAssistantRef.current?.id;
    if (closedStreamId) closedAssistantStreamIdsRef.current.add(closedStreamId);
    buffer.current = null;
    activeAssistantRef.current = null;
    return !!closedStreamId;
  }, []);

  const resolveActiveAssistantIndex = useCallback((prev: UIMessage[]): number | null => {
    const cursor = activeAssistantRef.current;
    if (!cursor) return null;
    const indexed = prev[cursor.index];
    if (
      indexed?.id === cursor.id
      && indexed.role === "assistant"
      && indexed.kind !== "trace"
      && indexed.isStreaming
    ) {
      return cursor.index;
    }
    const idx = prev.findIndex((m) => m.id === cursor.id);
    if (idx === -1) {
      activeAssistantRef.current = null;
      return null;
    }
    const found = prev[idx];
    if (found.role !== "assistant" || found.kind === "trace" || !found.isStreaming) {
      activeAssistantRef.current = null;
      return null;
    }
    activeAssistantRef.current = { id: cursor.id, index: idx };
    return idx;
  }, []);

  const appendAnswerChunk = useCallback(
    (
      prev: UIMessage[],
      chunk: string,
      streamId?: string,
      turnId?: string,
    ): UIMessage[] => {
      let next = prev;
      let targetIndex = resolveActiveAssistantIndex(next);
      if (targetIndex !== null && !sameTurn(next[targetIndex], turnId)) {
        targetIndex = null;
      }

      if (targetIndex === null) {
        targetIndex = findActiveAssistantPlaceholderIndex(next, turnId);
      }
      if (targetIndex === null) {
        targetIndex = findStreamingAssistantIndex(
          next,
          closedAssistantStreamIdsRef.current,
          turnId,
        );
      }
      if (targetIndex === null) {
        const id = crypto.randomUUID();
        next = [
          ...next,
          {
            id,
            role: "assistant",
            content: "",
            isStreaming: true,
            ...(streamId ? { streamId } : {}),
            ...(turnId ? { turnId } : {}),
            createdAt: Date.now(),
          },
        ];
        targetIndex = next.length - 1;
      }

      const target = next[targetIndex];
      const merged: UIMessage = {
        ...target,
        content: target.content + chunk,
        isStreaming: true,
        streamId: streamId ?? target.streamId,
        turnId: turnId ?? target.turnId,
      };
      closedAssistantStreamIdsRef.current.delete(merged.id);
      activeAssistantRef.current = { id: merged.id, index: targetIndex };
      buffer.current = {
        messageId: merged.id,
        streamId: streamId ?? target.streamId,
        turnId: turnId ?? target.turnId,
      };
      return replaceMessageAt(next, targetIndex, merged);
    },
    [resolveActiveAssistantIndex],
  );

  const applyPendingStreamEvents = useCallback(
    (prev: UIMessage[], events: PendingStreamEvent[]): UIMessage[] => {
      let next = prev;
      for (const event of events) {
        if (event.kind === "delta") {
          next = appendAnswerChunk(next, event.text, event.streamId, event.turnId);
        } else if (event.kind === "reasoning") {
          if (closeActiveAssistantStream()) clearActivitySegment();
          next = attachReasoningChunk(next, event.text, {
            ensure: ensureActivitySegmentId,
            turnId: event.turnId,
          });
        } else {
          if (closeActiveAssistantStream()) clearActivitySegment();
          next = closeReasoningStream(next);
          next = attachNarrationChunk(next, event.text, {
            ensure: ensureActivitySegmentId,
            streamId: event.streamId,
            replacesStreamId: event.replacesStreamId,
            turnId: event.turnId,
          });
        }
      }
      return next;
    },
    [appendAnswerChunk, clearActivitySegment, closeActiveAssistantStream, ensureActivitySegmentId],
  );

  const flushPendingStreamEvents = useCallback((options?: {
    closeAnswerSegment?: boolean;
    finalAnswerText?: string;
    reclassifyAsNarration?: boolean;
    streamId?: string;
    messageId?: string;
  }) => {
    if (streamFrameRef.current !== null) {
      window.cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
    }
    const events = pendingStreamEventsRef.current;
    const finalAnswerText = options?.finalAnswerText;
    if (
      events.length === 0
      && finalAnswerText === undefined
      && !options?.reclassifyAsNarration
    ) {
      if (options?.closeAnswerSegment) closeActiveAssistantStream();
      return;
    }
    pendingStreamEventsRef.current = [];
    setMessages((prev) => {
      let next = events.length > 0 ? applyPendingStreamEvents(prev, events) : prev;
      let targetIndex: number | null = options?.messageId
        ? next.findIndex((message) => message.id === options.messageId)
        : options?.streamId
          ? next.findIndex((message) => message.streamId === options.streamId)
          : null;
      if (targetIndex !== null && targetIndex < 0) targetIndex = null;
      if (finalAnswerText !== undefined) {
        targetIndex =
          targetIndex
          ?? resolveActiveAssistantIndex(next)
          ?? findStreamingAssistantIndex(next, closedAssistantStreamIdsRef.current);
        if (targetIndex !== null) {
          const target = next[targetIndex];
          next = replaceMessageAt(next, targetIndex, {
            ...target,
            content: finalAnswerText,
            isStreaming: true,
            streamId: options?.streamId ?? target.streamId,
          });
        } else {
          const id = crypto.randomUUID();
          closedAssistantStreamIdsRef.current.add(id);
          next = [
            ...next,
            {
              id,
              role: "assistant",
              content: finalAnswerText,
              isStreaming: true,
              ...(options?.streamId ? { streamId: options.streamId } : {}),
              createdAt: Date.now(),
            },
          ];
          targetIndex = next.length - 1;
        }
      }
      if (options?.reclassifyAsNarration) {
        targetIndex =
          targetIndex
          ?? resolveActiveAssistantIndex(next)
          ?? findStreamingAssistantIndex(next, closedAssistantStreamIdsRef.current);
        const messageId = targetIndex === null ? undefined : next[targetIndex]?.id;
        next = reclassifyAssistantStreamAsNarration(next, {
          messageId,
          streamId: options.streamId,
          ensureActivitySegment: ensureActivitySegmentId,
        });
      }
      if (options?.closeAnswerSegment) closeActiveAssistantStream();
      return next;
    });
  }, [
    applyPendingStreamEvents,
    closeActiveAssistantStream,
    ensureActivitySegmentId,
    resolveActiveAssistantIndex,
  ]);

  const schedulePendingStreamFlush = useCallback(() => {
    if (streamFrameRef.current !== null) return;
    streamFrameRef.current = window.requestAnimationFrame(() => {
      streamFrameRef.current = null;
      const events = pendingStreamEventsRef.current;
      if (events.length === 0) return;
      pendingStreamEventsRef.current = [];
      setMessages((prev) => applyPendingStreamEvents(prev, events));
    });
  }, [applyPendingStreamEvents]);

  // Reset local state when switching chats. Do not reset on every
  // ``initialMessages`` update: a brand-new chat can receive an empty/404
  // history response after the optimistic first message has already rendered.
  useEffect(() => {
    setMessages(initialMessages);
    setTurnUsage(undefined);
    setMessageConversationId(chatId);
    dispatchProtocol({
      type: 'reset',
      isStreaming: (
        runtimeSnapshotForClient(client, chatId)
          ? runtimeSnapshotForClient(client, chatId)?.thread_status.type === "active"
          : hasPendingToolCalls
      ),
      runStartedAt: chatId && client ? client.getRunStartedAt(chatId) : null,
      goalState: chatId && client ? client.getGoalState(chatId) : undefined,
    });
    buffer.current = null;
    activeAssistantRef.current = null;
    activeTurnIdRef.current = runtimeSnapshotForClient(client, chatId)?.active_turn?.id ?? null;
    lastAnswerStreamRef.current = null;
    closedAssistantStreamIdsRef.current.clear();
    clearActivitySegment();
    clearPendingStreamWork();
    suppressStreamUntilTurnEndRef.current = false;
    lifecycleTerminalHandledRef.current = false;
    if (streamEndTimerRef.current !== null) {
      clearTimeout(streamEndTimerRef.current);
      streamEndTimerRef.current = null;
    }
    // History is deliberately reset only when the selected chat changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, client, clearActivitySegment, clearPendingStreamWork]);

  useEffect(() => {
    if (
      hasPendingToolCalls
      && !runtimeSnapshotForClient(client, chatId)
    ) {
      setIsStreaming(true);
    }
  }, [chatId, client, hasPendingToolCalls, setIsStreaming]);

  useEffect(() => {
    if (!chatId || !client) return;

    const handle = (ev: InboundEvent) => {
      if (
        ev.event === "browser_frame"
        || ev.event === "browser_status"
        || ev.event === "browser_action"
      ) {
        useBrowserStore.getState().handleEvent(ev);
        return;
      }

      // Any incoming event while the debounce timer is alive means the model
      // is still working (e.g. tool result arrived, more text to stream).
      // Cancel the pending "stream ended" timer so we don't hide the spinner.
      if (streamEndTimerRef.current !== null) {
        clearTimeout(streamEndTimerRef.current);
        streamEndTimerRef.current = null;
      }

      if (ev.event === "delta") {
        if (suppressStreamUntilTurnEndRef.current) return;
        const chunk = typeof ev.text === "string" ? ev.text : "";
        if (!chunk) return;
        clearActivitySegment();
        setIsStreaming(true);
        const turnId = inboundTurnId(ev) ?? activeTurnIdRef.current ?? undefined;
        if (turnId) activeTurnIdRef.current = turnId;
        lastAnswerStreamRef.current = {
          streamId: ev.stream_id ?? lastAnswerStreamRef.current?.streamId,
          turnId: turnId ?? lastAnswerStreamRef.current?.turnId,
        };
        pendingStreamEventsRef.current.push({
          kind: "delta",
          text: chunk,
          streamId: ev.stream_id,
          turnId,
        });
        schedulePendingStreamFlush();
        return;
      }

      if (ev.event === "reasoning_delta") {
        if (suppressStreamUntilTurnEndRef.current) return;
        const chunk = ev.text;
        if (!chunk) return;
        if (fileEditSegmentRef.current) clearActivitySegment();
        setIsStreaming(true);
        const turnId = inboundTurnId(ev) ?? activeTurnIdRef.current ?? undefined;
        if (turnId) activeTurnIdRef.current = turnId;
        pendingStreamEventsRef.current.push({ kind: "reasoning", text: chunk, turnId });
        schedulePendingStreamFlush();
        return;
      }

      if (ev.event === "narration_delta") {
        const chunk = typeof ev.text === "string" ? ev.text : "";
        if (!chunk) return;
        setIsStreaming(true);
        const turnId = inboundTurnId(ev) ?? activeTurnIdRef.current ?? undefined;
        if (turnId) activeTurnIdRef.current = turnId;
        pendingStreamEventsRef.current.push({
          kind: "narration",
          text: chunk,
          streamId: ev.stream_id,
          replacesStreamId: ev.replaces_stream_id,
          turnId,
        });
        schedulePendingStreamFlush();
        return;
      }

      if (ev.event === "stream_end") {
        // The gateway can durably complete a turn before the outbound channel
        // delivers its final stream terminator:
        //
        //   delta... -> turn_completed -> stream_end
        //
        // ``turn_completed`` has already drained the pending delta queue and
        // queued the atomic message finalization. Letting this late terminator
        // close the cursor in between those queued state updates can detach the
        // last animation-frame worth of text into a second assistant message.
        // Treat it as an acknowledgement only; the terminal lifecycle event is
        // authoritative.
        if (lifecycleTerminalHandledRef.current) return;
        const messageId = buffer.current?.messageId ?? activeAssistantRef.current?.id;
        const streamId = ev.stream_id ?? buffer.current?.streamId;
        const isNarration = isNarrationStreamEnd(ev);
        const turnId = inboundTurnId(ev)
          ?? buffer.current?.turnId
          ?? activeTurnIdRef.current
          ?? undefined;
        if (!isNarration) {
          lastAnswerStreamRef.current = {
            streamId: streamId ?? lastAnswerStreamRef.current?.streamId,
            turnId: turnId ?? lastAnswerStreamRef.current?.turnId,
          };
        }
        // A media-bearing assistant frame is authoritative for the answer.
        // Ignore a later duplicate answer terminator, but keep public
        // narration protocol frames usable.
        if (suppressStreamUntilTurnEndRef.current && !isNarration) return;
        flushPendingStreamEvents({
          closeAnswerSegment: true,
          ...(typeof ev.text === "string" ? { finalAnswerText: ev.text } : {}),
          ...(streamId ? { streamId } : {}),
          ...(messageId ? { messageId } : {}),
          ...(isNarration ? { reclassifyAsNarration: true } : {}),
        });
        // stream_end only means the text segment finished — the model may
        // still be executing tools.  Do NOT reset isStreaming here; the
        // definitive "turn is complete" signal is ``turn_end``.
        return;
      }

      const shouldCloseAnswerBeforeEvent =
        ev.event === "file_edit"
        || (
          ev.event === "message"
          && (ev.kind === "tool_hint" || ev.kind === "progress")
        );
      flushPendingStreamEvents({ closeAnswerSegment: shouldCloseAnswerBeforeEvent });

      if (ev.event === "reasoning_end") {
        if (suppressStreamUntilTurnEndRef.current) return;
        setMessages((prev) => closeReasoningStream(prev));
        return;
      }

      if (ev.event === "narration_end") {
        setMessages((prev) => closeNarrationStream(
          prev,
          ev.stream_id ?? ev.replaces_stream_id,
        ));
        return;
      }

      if (ev.event === "artifact_created") {
        onArtifactCreated?.();
        return;
      }

      if (ev.event === "goal_state") {
        setGoalState(ev.goal_state);
        return;
      }

      if (ev.event === "turn_usage_updated") {
        const nextUsage = normalizeCurrentTurnUsage(ev.usage, ev.estimated);
        setTurnUsage((previous) => keepTurnUsageMonotonic(previous, nextUsage));
        return;
      }

      if (ev.event === "goal_status") {
        if (chatId && client?.getRuntimeSnapshot(chatId)) {
          return;
        }
        if (ev.status === "running" && typeof ev.started_at === "number") {
          setRunStartedAt(ev.started_at);
        } else {
          setRunStartedAt(null);
          setIsStreaming(false);
          setMessages(closeOpenStreams);
        }
        return;
      }

      if (ev.event === "turn_started") {
        lifecycleTerminalHandledRef.current = false;
        activeTurnIdRef.current = ev.turn.id;
        lastAnswerStreamRef.current = { turnId: ev.turn.id };
        setTurnUsage(undefined);
        useTurnPlanStore.getState().activateTurn(ev.chat_id, ev.turn.id);
        if (ev.turn.plan) {
          applyTurnPlanResource(ev.chat_id, ev.turn.plan);
          setMessages((prev) => applyPlanToMessages(prev, ev.turn.plan!));
        }
        setRunStartedAt(ev.turn.started_at);
        setIsStreaming(true);
        return;
      }

      if (ev.event === "thread_status_changed") {
        const snapshotTurn = ev.thread_status.type === "active"
          ? ev.active_turn
          : ev.latest_turn;
        if (snapshotTurn?.id) {
          useTurnPlanStore.getState().activateTurn(ev.chat_id, snapshotTurn.id);
        }
        // While a new turn is active, the latest terminal turn is historical
        // context, never a fallback for the current right-rail progress.
        const snapshotPlan = snapshotTurn?.plan;
        if (snapshotPlan) {
          applyTurnPlanResource(ev.chat_id, snapshotPlan);
          setMessages((prev) => applyPlanToMessages(prev, snapshotPlan));
        }
        if (ev.thread_status.type === "active") {
          activeTurnIdRef.current = ev.active_turn?.id ?? activeTurnIdRef.current;
          if (ev.active_turn?.started_at) setRunStartedAt(ev.active_turn.started_at);
          setIsStreaming(true);
        } else if (ev.thread_status.type === "systemError") {
          setRunStartedAt(null);
          setIsStreaming(false);
          setMessages(finalizeFailedTurnProgress);
        } else {
          setRunStartedAt(null);
          setIsStreaming(false);
          setMessages(closeOpenStreams);
        }
        return;
      }

      if (
        ev.event === 'turn_plan_created'
        || ev.event === 'turn_plan_updated'
        || ev.event === 'turn_plan_rebased'
        || ev.event === 'turn_plan_terminalized'
      ) {
        applyTurnPlanResource(ev.chat_id, ev.plan);
        setMessages((prev) => applyPlanToMessages(prev, ev.plan));
        return;
      }

      if (ev.event === "team_run_started") {
        const id = `team-run-${ev.run_id}`;
        const hasDataPackage = ev.team_id === "asset-research-team";
        const hasScopeBrief = ev.team_id === "supply-chain-bottleneck-team";
        const hasPreparation = hasDataPackage || hasScopeBrief;
        const stagedMembers = ev.members.filter((member) => member.phase);
        const firstPhase = stagedMembers[0]?.phase;
        const firstPhaseCount = firstPhase
          ? stagedMembers.filter((member) => member.phase === firstPhase).length
          : ev.members.length;
        const steps = [
          ...(hasPreparation ? [{
            id: hasDataPackage ? "data-package" : "scope-brief",
            title: hasDataPackage ? "建立基础数据包" : "建立研究主题卡",
            detail: hasDataPackage
              ? "正在统一公司摘要、财务指标、公告新闻和行业数据"
              : "正在明确趋势、地域、时间窗口和第一阶段研究边界",
            status: "running" as const,
          }] : []),
          ...ev.members.map((member) => ({
            id: member.id,
            title: `${member.name}${member.framework ? ` · ${member.framework}` : ""}`,
            detail: member.description || "团队已启动，正在分配研究任务",
            // The gateway emits this frame immediately before dispatching the
            // members. Showing an active state here keeps the UI truthful to
            // the running team even if a follow-up member frame is delayed.
            status: (
              hasPreparation
                ? "pending"
                : !firstPhase || member.phase === firstPhase
                  ? "running"
                  : "pending"
            ) as TaskProgressStep["status"],
          })),
          {
            id: "team-lead",
            title: "主笔交叉质证与汇总",
            detail: "等待各位专家交付后进行交叉质证",
            status: "pending" as const,
          },
          {
            id: "report-audit",
            title: "报告审校与交付",
            detail: "等待交叉质证完成后核验关键结论并生成报告",
            status: "pending" as const,
          },
        ];
        setMessages((prev) => [
          ...prev.filter((message) => message.id !== id),
          {
            id,
            role: "tool",
            kind: "trace",
            content: `${ev.team_name}已启动`,
            traces: [`${ev.team_name}已启动`],
            agentUI: {
              kind: "task_progress",
              steps,
              note: hasDataPackage
                ? "Team Lead 正在建立公司基础数据包，完成后启动四位专家"
                : hasScopeBrief
                ? "Team Lead 正在建立研究主题卡，完成后启动第一阶段两位专家"
                : firstPhase && firstPhaseCount < ev.members.length
                ? `${ev.members.length} 位专家将分阶段协作，首阶段 ${firstPhaseCount} 位并行研究`
                : `${ev.members.length} 位专家正在并行研究`,
              team_name: ev.team_name,
              team_id: ev.team_id,
              team_run_id: ev.run_id,
            },
            createdAt: Date.now(),
          },
        ]);
        return;
      }

      if (ev.event === "team_member_updated") {
        const canonicalTeamPlan = useTurnPlanStore.getState().planByConversation[ev.chat_id];
        if (
          canonicalTeamPlan
          && workflowPlanMatchesMemberEvent(canonicalTeamPlan, ev)
        ) {
          const livePlan = overlayTeamMemberUpdateOnPlan(canonicalTeamPlan, ev);
          setMessages((prev) => applyPlanToMessages(prev, livePlan));
          return;
        }
        setMessages((prev) => prev.map((message) => {
          const targetId = teamProgressMessageId(prev, ev.team_id, ev.run_id);
          if (message.id !== targetId || message.agentUI?.kind !== "task_progress") return message;
          const progress = message.agentUI as {
            kind: "task_progress";
            steps: TaskProgressStep[];
            note?: string;
            current_step_id?: string;
            team_name?: string;
            team_id?: string;
            team_run_id?: string;
          };
          const status = ev.member.status === "running"
            ? "running"
            : "completed";
          const steps = progress.steps.map((step) => (
            step.id === ev.member.id
              ? {
                  ...step,
                  title: ev.member.status === "failed"
                    ? `${step.title.replace(/（已降级）$|（已停止）$/, "")}（已降级）`
                    : ev.member.status === "cancelled"
                      ? `${step.title.replace(/（已降级）$|（已停止）$/, "")}（已停止）`
                      : step.title.replace(/（已降级）$|（已停止）$/, ""),
                  detail: ev.member.activity || step.detail,
                  status,
                }
              : step
          ));
          return {
            ...message,
            content: ev.member.activity || `${ev.member.name}${ev.member.status === "running" ? "正在研究" : "已完成"}`,
            traces: [ev.member.activity || `${ev.member.name}${ev.member.status === "running" ? "正在研究" : "已完成"}`],
            agentUI: {
              ...progress,
              steps,
              current_step_id: ev.member.status === "running" ? ev.member.id : undefined,
              note: ev.member.status === "failed"
                ? "部分维度已降级，团队将继续完成报告"
                : ev.member.status === "cancelled"
                  ? "主任务已停止，后台专家和并发槽位已释放"
                  : message.agentUI.note,
            },
          };
        }));
        return;
      }

      if (ev.event === "team_run_completed") {
        const canonicalTeamPlan = useTurnPlanStore.getState().planByConversation[ev.chat_id];
        if (canonicalTeamPlan?.kind === 'workflow') {
          setMessages((prev) => applyPlanToMessages(prev, canonicalTeamPlan));
          return;
        }
        setMessages((prev) => prev.map((message) => {
          const targetId = teamProgressMessageId(prev, ev.team_id, ev.run_id);
          if (message.id !== targetId || message.agentUI?.kind !== "task_progress") return message;
          const progress = message.agentUI as {
            kind: "task_progress";
            steps: TaskProgressStep[];
            note?: string;
            current_step_id?: string;
            team_name?: string;
            team_id?: string;
            team_run_id?: string;
          };
          const teamName = progress.team_name || "专家团队";
          return {
            ...message,
            content: `${teamName}已完成`,
            traces: [`${teamName}已完成`],
            agentUI: {
              ...progress,
              steps: progress.steps.map((step) => ({ ...step, status: "completed" as const })),
              current_step_id: undefined,
              note: ev.status === "completed_with_warnings" ? "已完成，部分维度采用降级结果" : "研究与报告已完成",
            },
          };
        }));
        return;
      }

      if (ev.event === "turn_completed" || ev.event === "turn_end") {
        const wasLifecycleHandled = lifecycleTerminalHandledRef.current;
        if (ev.event === "turn_end" && ev.goal_state != null && typeof ev.goal_state === "object") {
          setGoalState(ev.goal_state);
        }
        setRunStartedAt(null);
        const terminalUsage = ev.event === "turn_completed"
          ? normalizeCurrentTurnUsage(
              ev.turn.usage,
              (ev.turn.usage?.estimated_tokens ?? 0) > 0,
            )
          : normalizeCurrentTurnUsage(ev.usage, false);
        if (terminalUsage) {
          setTurnUsage((previous) => keepTurnUsageMonotonic(previous, terminalUsage));
        }
        // Definitive signal that the turn is fully complete.  Cancel any
        // pending debounce timer and stop the loading indicator immediately.
        if (streamEndTimerRef.current !== null) {
          clearTimeout(streamEndTimerRef.current);
          streamEndTimerRef.current = null;
        }
        setIsStreaming(false);
        if (ev.event === 'turn_completed' && ev.turn.plan) {
          useTurnPlanStore.getState().activateTurn(ev.chat_id, ev.turn.id);
          applyTurnPlanResource(ev.chat_id, ev.turn.plan);
        }
        setMessages((prev) => {
          const interrupted = ev.event === "turn_completed"
            ? ev.turn.status === "interrupted"
            : ev.finish_reason === "cancelled";
          const failed = ev.event === "turn_completed"
            ? ev.turn.status === "failed"
            : ev.finish_reason === "error";
          const interruptedAt = ev.event === "turn_completed"
            && typeof ev.turn.completed_at === "number"
            && Number.isFinite(ev.turn.completed_at)
            ? ev.turn.completed_at
            : Date.now();
          let finalized = interrupted
            ? finalizeInterruptedTurn(prev, interruptedAt)
            : closeOpenStreams(prev);
          if (ev.event === 'turn_completed' && ev.turn.plan) {
            finalized = applyPlanToMessages(finalized, ev.turn.plan);
          }
          if (
            ev.event === "turn_completed"
            && ev.turn.status === "completed"
          ) {
            finalized = finalizeCompletedTurnProgress(finalized);
          }
          if (failed) {
            finalized = finalizeFailedTurnProgress(finalized);
          }
          finalized = pruneReasoningOnlyPlaceholders(finalized);
          if (
            ev.event === "turn_end"
            && typeof ev.latency_ms === "number"
            && ev.latency_ms >= 0
          ) {
            finalized = stampLastAssistantLatency(finalized, Math.round(ev.latency_ms));
          }
          if (ev.event === "turn_completed") {
            if (
              typeof ev.turn.duration_ms === "number"
              && Number.isFinite(ev.turn.duration_ms)
              && ev.turn.duration_ms >= 0
            ) {
              finalized = stampLastAssistantLatency(
                finalized,
                Math.round(ev.turn.duration_ms),
              );
            }
            if (
              typeof ev.turn.completed_at === "number"
              && Number.isFinite(ev.turn.completed_at)
              && ev.turn.completed_at >= 0
            ) {
              finalized = stampLastAssistantCompletedAt(
                finalized,
                ev.turn.completed_at,
              );
            }
          }
          if (ev.event === "turn_end") {
            const turnUsage = normalizeTurnUsage(ev.usage);
            if (turnUsage) {
              finalized = stampLastAssistantUsage(finalized, turnUsage);
            }
          }
          buffer.current = null;
          activeAssistantRef.current = null;
          clearActivitySegment();
          closedAssistantStreamIdsRef.current.clear();
          return finalized;
        });
        suppressStreamUntilTurnEndRef.current = false;
        if (ev.event === "turn_completed") {
          activeTurnIdRef.current = ev.turn.id;
          lastAnswerStreamRef.current = {
            ...lastAnswerStreamRef.current,
            turnId: ev.turn.id,
          };
          lifecycleTerminalHandledRef.current = true;
        }
        if (!wasLifecycleHandled) onTurnEnd?.();
        return;
      }

      if (ev.event === "message") {
        if (
          suppressStreamUntilTurnEndRef.current &&
          (
            ev.kind === "reasoning"
            || (
              (ev.kind === "tool_hint" || ev.kind === "progress")
              && ev.agent_ui == null
              && normalizeToolProgressEvents(ev.tool_events).length === 0
            )
          )
        ) {
          return;
        }
        // Back-compat: a legacy ``kind: "reasoning"`` message (no streaming
        // partner) is treated as one complete delta + immediate end so the
        // bubble renders identically to the streaming path.
        if (ev.kind === "reasoning") {
          const line = ev.text;
          if (!line) return;
          if (fileEditSegmentRef.current) clearActivitySegment();
          setMessages((prev) => closeReasoningStream(attachReasoningChunk(prev, line, {
            ensure: ensureActivitySegmentId,
          })));
          return;
        }
        // Intermediate agent breadcrumbs (tool-call hints, raw progress).
        // Attach them to the last trace row if it was the last emitted item
        // so a sequence of calls collapses into one compact trace group.
        if (ev.kind === "tool_hint" || ev.kind === "progress") {
          const structuredEvents = normalizeToolProgressEvents(ev.tool_events);
          const agentUI = ev.agent_ui;
          if (agentUI?.kind === "task_progress") {
            const currentTurnId = useTurnPlanStore.getState()
              .currentTurnByConversation[ev.chat_id];
            const plan = planFromAgentUI(
              agentUI,
              currentTurnId ?? ev.chat_id,
            );
            if (plan) {
              const explicitTurnId = (
                typeof agentUI.turn_id === 'string'
                && agentUI.turn_id.trim()
              ) || null;
              if (explicitTurnId && !currentTurnId) {
                useTurnPlanStore.getState().activateTurn(ev.chat_id, explicitTurnId);
              }
              applyTurnPlanResource(ev.chat_id, plan);
            }
          }
          const workspaceReason = workspaceAccessRequiredReason(structuredEvents);
          if (workspaceReason) {
            setStreamError({
              kind: "workspace_access_required",
              chatId,
              reason: workspaceReason,
            });
          }
          setMessages((prev) => {
            const segmentId = ensureActivitySegmentId();
            const base = prev;
            const visibleStructuredEvents = filterCoveredFileEditToolEvents(base, structuredEvents);
            const structuredLines = toolTraceLinesFromEvents(visibleStructuredEvents);
            const lines = structuredLines.length > 0
              ? structuredLines
              : structuredEvents.length > 0
                ? []
                : agentUI?.kind
                  ? [agentUI.kind]
                : ev.text
                  ? [ev.text]
                  : [];
            if (lines.length === 0) return base;
            const last = base[base.length - 1];
            let replacedProgressIndex = -1;
            if (agentUI?.kind === "task_progress") {
              for (let index = base.length - 1; index >= 0; index -= 1) {
                const candidate = base[index];
                if (candidate.role === "user") break;
                if (
                  candidate.kind === "trace"
                  && !candidate.isStreaming
                  && !candidate.narration
                  && isSameTaskProgressPlan(candidate.agentUI, agentUI)
                ) {
                  replacedProgressIndex = index;
                  break;
                }
              }
            }
            if (replacedProgressIndex >= 0) {
              const previous = base[replacedProgressIndex];
              const previousTraces = previous.traces?.length
                ? previous.traces
                : previous.content
                  ? [previous.content]
                  : [];
              const mergedLines = visibleStructuredEvents.length > 0
                ? mergeUniqueToolTraceLines(previousTraces, structuredLines)
                : null;
              const replacement: UIMessage = {
                ...previous,
                traces: mergedLines?.traces ?? (previousTraces.length ? previousTraces : lines),
                content: mergedLines
                  ? mergedLines.traces[mergedLines.traces.length - 1]
                  : previous.content || lines[lines.length - 1],
                toolEvents: visibleStructuredEvents.length
                  ? mergeToolProgressEvents(previous.toolEvents, visibleStructuredEvents)
                  : previous.toolEvents,
                agentUI,
                activitySegmentId: segmentId,
                createdAt: Date.now(),
              };
              // Move the mutable plan card to the newest event position. This
              // matches the canonical history projection while keeping the
              // live transcript at constant size even across media/tool rows.
              return [
                ...base.slice(0, replacedProgressIndex),
                ...base.slice(replacedProgressIndex + 1),
                replacement,
              ];
            }
            if (
              last
              && last.kind === "trace"
              && !last.isStreaming
              && !last.narration
              && !(agentUI?.kind === "task_progress" && last.agentUI?.kind === "task_progress")
              && (!last.activitySegmentId || last.activitySegmentId === segmentId)
            ) {
              const previousTraces = last.traces?.length
                ? last.traces
                : last.content
                  ? [last.content]
                  : [];
              const mergedLines = visibleStructuredEvents.length > 0
                ? mergeUniqueToolTraceLines(previousTraces, structuredLines)
                : null;
              const merged: UIMessage = {
                ...last,
                traces: mergedLines ? mergedLines.traces : [...previousTraces, ...lines],
                content: mergedLines
                  ? mergedLines.traces[mergedLines.traces.length - 1]
                  : lines[lines.length - 1],
                toolEvents: visibleStructuredEvents.length
                  ? mergeToolProgressEvents(last.toolEvents, visibleStructuredEvents)
                  : last.toolEvents,
                agentUI: agentUI ?? last.agentUI,
                activitySegmentId: last.activitySegmentId ?? segmentId,
              };
              return [...base.slice(0, -1), merged];
            }
            return [
              ...base,
              {
                id: crypto.randomUUID(),
                role: "tool",
                kind: "trace",
                content: lines[lines.length - 1],
                traces: lines,
                ...(visibleStructuredEvents.length ? { toolEvents: visibleStructuredEvents } : {}),
                ...(agentUI ? { agentUI } : {}),
                activitySegmentId: segmentId,
                createdAt: Date.now(),
              },
            ];
          });
          return;
        }

        const media = ev.media_urls?.length
          ? ev.media_urls.map((m) => toMediaAttachment(m))
          : ev.media?.map((url) => toMediaAttachment({ url }));
        const hasMedia = !!media && media.length > 0;
        if (suppressStreamUntilTurnEndRef.current && !hasMedia) {
          // A media-bearing assistant frame already supplied the authoritative
          // answer. Ignore a later legacy duplicate body while still allowing
          // additional attachment frames and structured progress above.
          return;
        }

        // A complete (non-streamed) assistant message. If a stream was in
        // flight, drop the placeholder so we don't render the text twice.
        // Do NOT reset isStreaming here — only ``turn_end`` signals that
        // the full turn (all tool calls + final text) is complete.
        clearActivitySegment();
        const eventTurn = inboundTurnId(ev)
          ?? lastAnswerStreamRef.current?.turnId
          ?? activeTurnIdRef.current
          ?? undefined;
        const answerStream = (
          !lastAnswerStreamRef.current?.turnId
          || !eventTurn
          || lastAnswerStreamRef.current.turnId === eventTurn
        )
          ? lastAnswerStreamRef.current?.streamId
          : undefined;
        const eventId = inboundStringField(ev, "event_id");
        setMessages((prev) => {
          const activeId = buffer.current?.messageId;
          buffer.current = null;
          activeAssistantRef.current = null;
          const filtered = activeId && ev.replace_stream !== true
            ? prev.filter((m) => m.id !== activeId)
            : prev;
          const content = ev.text;
          const lat =
            typeof ev.latency_ms === "number" && ev.latency_ms >= 0
              ? Math.round(ev.latency_ms)
              : undefined;
          return absorbCompleteAssistantMessage(filtered, {
            content,
            ...(ev.interactive_prompt ? { interactivePrompt: ev.interactive_prompt } : {}),
            ...(hasMedia ? { media } : {}),
            ...(lat !== undefined ? { latencyMs: lat } : {}),
          }, {
            replaceStream: ev.replace_stream === true,
            streamId: answerStream,
            turnId: eventTurn,
            eventId,
          });
        });
        if (hasMedia) {
          suppressStreamUntilTurnEndRef.current = true;
        }
        return;
      }
      if (ev.event === "file_edit") {
        const edits = Array.isArray(ev.edits) ? ev.edits : [];
        if (edits.length === 0) return;
        const normalized = mergeFileEdits(undefined, edits);
        if (normalized.length === 0) return;
        const opensFileEditPhase = normalized.some(
          (edit) => edit.status === "editing" || edit.phase === "start",
        );
        let eventSegmentId = fileEditSegmentRef.current;
        if (!eventSegmentId && opensFileEditPhase) {
          eventSegmentId = detachedActivitySegmentId();
          fileEditSegmentRef.current = eventSegmentId;
        }
        setMessages((prev) => {
          let segmentId = eventSegmentId;
          const base = prev;
          const targetIndex = findFileEditTraceIndex(base, segmentId, normalized);
          if (targetIndex !== null) {
            const target = base[targetIndex];
            segmentId = target.activitySegmentId ?? segmentId ?? detachedActivitySegmentId();
            if (opensFileEditPhase) fileEditSegmentRef.current = segmentId;
            const cleanedTarget = stripCoveredFileEditToolHints(target, normalized);
            const merged: UIMessage = {
              ...cleanedTarget,
              fileEdits: mergeFileEdits(cleanedTarget.fileEdits, normalized),
              activitySegmentId: segmentId,
            };
            return replaceMessageAt(base, targetIndex, merged);
          }
          segmentId = segmentId ?? detachedActivitySegmentId();
          if (opensFileEditPhase) fileEditSegmentRef.current = segmentId;
          return [
            ...base,
            {
              id: crypto.randomUUID(),
              role: "tool",
              kind: "trace",
              content: "",
              traces: [],
              fileEdits: normalized,
              activitySegmentId: segmentId,
              createdAt: Date.now(),
            },
          ];
        });
        if (normalized.some((edit) => (
          edit.status === "done" && edit.operation !== "delete"
        ))) {
          onArtifactCreated?.();
        }
        return;
      }
      // ``attached`` / ``error`` frames aren't actionable here; the client
      // shell handles them separately.
    };

    const unsub = client.onChat(chatId, handle);
    const runtimeSubscriber = (
      client as ReturnType<typeof getNanobotClient> & {
        onRuntimeSnapshot?: ReturnType<typeof getNanobotClient>["onRuntimeSnapshot"];
      }
    ).onRuntimeSnapshot;
    const unsubRuntime = typeof runtimeSubscriber === "function"
      ? runtimeSubscriber.call(client, (snapshotChatId, snapshot) => {
          if (snapshotChatId !== chatId) return;
          const active = snapshot.thread_status.type === "active";
          setRunStartedAt(
            active && snapshot.active_turn
              ? snapshot.active_turn.started_at
              : null,
          );
          setIsStreaming(active);
          if (!active) {
            setMessages((prev) => snapshot.thread_status.type === "systemError"
              ? finalizeFailedTurnProgress(prev)
              : closeOpenStreams(prev));
          }
        })
      : () => {};
    return () => {
      unsub();
      unsubRuntime();
      buffer.current = null;
      activeAssistantRef.current = null;
      activeTurnIdRef.current = null;
      lastAnswerStreamRef.current = null;
      closedAssistantStreamIdsRef.current.clear();
      clearActivitySegment();
      clearPendingStreamWork();
      if (streamEndTimerRef.current !== null) {
        clearTimeout(streamEndTimerRef.current);
        streamEndTimerRef.current = null;
      }
    };
  }, [
    chatId,
    client,
    clearActivitySegment,
    clearPendingStreamWork,
    detachedActivitySegmentId,
    ensureActivitySegmentId,
    flushPendingStreamEvents,
    onArtifactCreated,
    onTurnEnd,
    schedulePendingStreamFlush,
    setGoalState,
    setIsStreaming,
    setRunStartedAt,
    setStreamError,
  ]);

  const send = useCallback(
    (content: string, images?: SendImage[], options?: SendOptions) => {
      if (!chatId) return false;
      if (!client || client.status !== "open") return false;
      const hasImages = !!images && images.length > 0;
      // Text is optional when images are attached — the agent will still see
      // the image blocks via ``media`` paths.
      if (!hasImages && !content.trim()) return false;

      flushPendingStreamEvents();
      const previews = hasImages ? images!.map((i) => i.preview) : undefined;
      setMessages((prev) => {
        buffer.current = null;
        activeAssistantRef.current = null;
        activeTurnIdRef.current = null;
        lastAnswerStreamRef.current = null;
        closedAssistantStreamIdsRef.current.clear();
        clearActivitySegment();
        return [
          ...pruneReasoningOnlyPlaceholders(prev),
          {
            id: crypto.randomUUID(),
            role: "user",
            content,
            createdAt: Date.now(),
            ...(previews ? { images: previews } : {}),
            ...(options?.interactivePromptAnswer ? { interactivePromptAnswer: options.interactivePromptAnswer } : {}),
            ...(options?.cliApps?.length ? { cliApps: options.cliApps } : {}),
            ...(options?.mcpPresets?.length ? { mcpPresets: options.mcpPresets } : {}),
            ...(options?.skillScope?.explicit_skills?.length
              ? { skills: options.skillScope.explicit_skills }
              : {}),
          },
        ];
      });
      // Mark streaming immediately so the UI shows the loading indicator
      // right away, before the first delta arrives from the server.
      setTurnUsage(undefined);
      setIsStopping(false);
      setIsStreaming(true);
      const wireMedia = hasImages ? images!.map((i) => i.media) : undefined;
      if (options) {
        client.sendMessage(chatId, content, wireMedia, options);
      } else {
        client.sendMessage(chatId, content, wireMedia);
      }
      return true;
    },
    [chatId, clearActivitySegment, client, flushPendingStreamEvents, setIsStopping, setIsStreaming],
  );

  const stop = useCallback(() => {
    if (!chatId || !client || !isStreaming || isStopping) return;
    flushPendingStreamEvents();
    setIsStopping(true);
    client.sendMessage(chatId, "/stop");
  }, [chatId, client, flushPendingStreamEvents, isStopping, isStreaming, setIsStopping]);

  return {
    messages: visibleMessages,
    messageConversationId: messageConversationId === chatId
      ? messageConversationId
      : null,
    isStreaming,
    isStopping,
    runStartedAt,
    turnUsage,
    goalState,
    send,
    stop,
    setMessages,
    streamError,
    dismissStreamError,
  };
}
