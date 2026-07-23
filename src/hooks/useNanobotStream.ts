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
  UIImage,
  UIFileEdit,
  UIMediaAttachment,
  UIMessage,
  WorkspaceScopePayload,
} from "@/core/types";
import {
  initialStreamProtocolState,
  streamProtocolReducer,
} from '@/core/nanobot/streamProtocol';

interface StreamBuffer {
  /** ID of the assistant message currently receiving deltas (cleared on ``stream_end``). */
  messageId: string;
}

interface ActiveAssistantCursor {
  id: string;
  index: number;
}

type PendingStreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "reasoning"; text: string };

const FILE_EDIT_TOOL_NAMES = new Set(["write_file", "edit_file", "apply_patch"]);
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
): number | null {
  for (let i = prev.length - 1; i >= 0; i -= 1) {
    const m = prev[i];
    if (m.kind === "trace") continue;
    if (m.role === "assistant" && m.isStreaming && !closedStreamIds.has(m.id)) return i;
    if (m.role === "user") break;
  }
  return null;
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
  },
): UIMessage[] {
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
function findActiveAssistantPlaceholderIndex(prev: UIMessage[]): number | null {
  const last = prev[prev.length - 1];
  if (!last) return null;
  if (last.role !== "assistant" || last.kind === "trace") return null;
  if (last.content.length > 0) return null;
  if (!last.isStreaming) return null;
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
export function closeReasoningStream(prev: UIMessage[]): UIMessage[] {
  for (let i = prev.length - 1; i >= 0; i -= 1) {
    const candidate = prev[i];
    if (!candidate.reasoningStreaming) continue;
    const merged: UIMessage = {
      ...candidate,
      reasoningStreaming: false,
    };
    return [...prev.slice(0, i), merged, ...prev.slice(i + 1)];
  }
  return prev;
}

/**
 * Close every locally-open stream when a user interrupts a turn.  The gateway
 * remains the authority for elapsed time, so an interrupted placeholder must
 * never turn its age into a fictional completed-turn latency.
 */
export function finalizeInterruptedTurn(prev: UIMessage[]): UIMessage[] {
  return prev.map((message) => {
    const cancelledPlan = message.agentUI?.kind === "task_progress"
      ? {
        ...message.agentUI,
        steps: message.agentUI.steps.map((step) => (
          step.status === "running"
            ? {
              ...step,
              status: "error" as const,
              detail: step.detail ? `${step.detail}（已由用户终止）` : "已由用户终止",
            }
            : step
        )),
        current_step_id: undefined,
        note: "任务已由用户终止",
      }
      : undefined;
    const cancelledToolEvents = message.toolEvents?.map((event) => (
      event.phase === "start"
        ? { ...event, phase: "error", error: "已由用户终止" }
        : event
    ));
    const cancelledFileEdits = message.fileEdits?.map((edit) => (
      edit.status === "editing"
        ? { ...edit, status: "error" as const, phase: "error", error: "已由用户终止" }
        : edit
    ));
    const hasInterruptedWork = message.isStreaming
      || message.reasoningStreaming
      || message.agentUI?.kind === "task_progress" && message.agentUI.steps.some((step) => step.status === "running")
      || message.toolEvents?.some((event) => event.phase === "start")
      || message.fileEdits?.some((edit) => edit.status === "editing");
    if (!hasInterruptedWork) return message;
    return {
      ...message,
      isStreaming: false,
      reasoningStreaming: false,
      ...(cancelledPlan ? { agentUI: cancelledPlan } : {}),
      ...(cancelledToolEvents ? { toolEvents: cancelledToolEvents } : {}),
      ...(cancelledFileEdits ? { fileEdits: cancelledFileEdits } : {}),
    };
  });
}

function closeOpenStreams(prev: UIMessage[]): UIMessage[] {
  return prev.map((message) => (
    message.isStreaming || message.reasoningStreaming
      ? { ...message, isStreaming: false, reasoningStreaming: false }
      : message
  ));
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

export function absorbCompleteAssistantMessage(
  prev: UIMessage[],
  message: Omit<UIMessage, "id" | "role" | "createdAt">,
  options?: { replaceStream?: boolean },
): UIMessage[] {
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
      },
    ];
  }
  return [
    ...prev.slice(0, -1),
    {
      ...last,
      ...message,
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

export function useNanobotStream(
  chatId: string | null,
  initialMessages: UIMessage[] = [],
  hasPendingToolCalls = false,
  onTurnEnd?: () => void,
): {
  messages: UIMessage[];
  isStreaming: boolean;
  /** Unix epoch seconds when the current user turn started (WebSocket ``goal_status``). */
  runStartedAt: number | null;
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
  /** If the last loaded message is a trace row (e.g. "Using 2 tools"),
   * the model was still processing when the page loaded — keep the
   * loading spinner alive so the user sees the model is active. */
  const initialStreaming = initialMessages.length > 0
    ? initialMessages[initialMessages.length - 1].kind === "trace"
    : false;
  const [protocol, dispatchProtocol] = useReducer(streamProtocolReducer, {
    ...initialStreamProtocolState,
    isStreaming: initialStreaming || hasPendingToolCalls,
  });
  const { isStreaming, runStartedAt, goalState, streamError } = protocol;
  const setIsStreaming = useCallback((value: boolean) => dispatchProtocol({ type: 'streaming', value }), []);
  const setGoalState = useCallback((value: GoalStateWsPayload | undefined) => dispatchProtocol({ type: 'goal_state', value }), []);
  const setRunStartedAt = useCallback((value: number | null) => dispatchProtocol({ type: 'goal_status', status: value === null ? 'idle' : 'running', ...(value === null ? {} : { startedAt: value }) }), []);
  const setStreamError = useCallback((value: StreamError | null) => dispatchProtocol({ type: 'error', value }), []);
  const buffer = useRef<StreamBuffer | null>(null);
  const activeAssistantRef = useRef<ActiveAssistantCursor | null>(null);
  const closedAssistantStreamIdsRef = useRef<Set<string>>(new Set());
  const activitySegmentRef = useRef<string | null>(null);
  const fileEditSegmentRef = useRef<string | null>(null);
  const activitySegmentCounterRef = useRef(0);
  const pendingStreamEventsRef = useRef<PendingStreamEvent[]>([]);
  const streamFrameRef = useRef<number | null>(null);
  const suppressStreamUntilTurnEndRef = useRef(false);
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
    (prev: UIMessage[], chunk: string): UIMessage[] => {
      let next = prev;
      let targetIndex = resolveActiveAssistantIndex(next);

      if (targetIndex === null) {
        targetIndex = findActiveAssistantPlaceholderIndex(next);
      }
      if (targetIndex === null) {
        targetIndex = findStreamingAssistantIndex(next, closedAssistantStreamIdsRef.current);
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
      };
      closedAssistantStreamIdsRef.current.delete(merged.id);
      activeAssistantRef.current = { id: merged.id, index: targetIndex };
      buffer.current = { messageId: merged.id };
      return replaceMessageAt(next, targetIndex, merged);
    },
    [resolveActiveAssistantIndex],
  );

  const applyPendingStreamEvents = useCallback(
    (prev: UIMessage[], events: PendingStreamEvent[]): UIMessage[] => {
      let next = prev;
      for (let i = 0; i < events.length;) {
        const kind = events[i].kind;
        let text = "";
        while (i < events.length && events[i].kind === kind) {
          text += events[i].text;
          i += 1;
        }
        if (kind === "delta") {
          next = appendAnswerChunk(next, text);
        } else {
          if (closeActiveAssistantStream()) clearActivitySegment();
          next = attachReasoningChunk(next, text, {
            ensure: ensureActivitySegmentId,
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
  }) => {
    if (streamFrameRef.current !== null) {
      window.cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
    }
    const events = pendingStreamEventsRef.current;
    const finalAnswerText = options?.finalAnswerText;
    if (events.length === 0 && finalAnswerText === undefined) {
      if (options?.closeAnswerSegment) closeActiveAssistantStream();
      return;
    }
    pendingStreamEventsRef.current = [];
    setMessages((prev) => {
      let next = events.length > 0 ? applyPendingStreamEvents(prev, events) : prev;
      if (finalAnswerText !== undefined) {
        const targetIndex =
          resolveActiveAssistantIndex(next)
          ?? findStreamingAssistantIndex(next, closedAssistantStreamIdsRef.current);
          if (targetIndex !== null) {
            const target = next[targetIndex];
            next = replaceMessageAt(next, targetIndex, {
              ...target,
              content: finalAnswerText,
              isStreaming: true,
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
                createdAt: Date.now(),
              },
            ];
          }
        }
      if (options?.closeAnswerSegment) closeActiveAssistantStream();
      return next;
    });
  }, [applyPendingStreamEvents, closeActiveAssistantStream, resolveActiveAssistantIndex]);

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
    dispatchProtocol({
      type: 'reset',
      isStreaming: (initialMessages.length > 0
        ? initialMessages[initialMessages.length - 1].kind === "trace"
        : false) || hasPendingToolCalls,
      runStartedAt: chatId && client ? client.getRunStartedAt(chatId) : null,
      goalState: chatId && client ? client.getGoalState(chatId) : undefined,
    });
    buffer.current = null;
    activeAssistantRef.current = null;
    closedAssistantStreamIdsRef.current.clear();
    clearActivitySegment();
    clearPendingStreamWork();
    suppressStreamUntilTurnEndRef.current = false;
    if (streamEndTimerRef.current !== null) {
      clearTimeout(streamEndTimerRef.current);
      streamEndTimerRef.current = null;
    }
    // History is deliberately reset only when the selected chat changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, client, clearActivitySegment, clearPendingStreamWork]);

  useEffect(() => {
    if (hasPendingToolCalls) setIsStreaming(true);
  }, [hasPendingToolCalls, setIsStreaming]);

  useEffect(() => {
    if (!chatId || !client) return;

    const handle = (ev: InboundEvent) => {
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
        pendingStreamEventsRef.current.push({ kind: "delta", text: chunk });
        schedulePendingStreamFlush();
        return;
      }

      if (ev.event === "reasoning_delta") {
        if (suppressStreamUntilTurnEndRef.current) return;
        const chunk = ev.text;
        if (!chunk) return;
        if (fileEditSegmentRef.current) clearActivitySegment();
        setIsStreaming(true);
        pendingStreamEventsRef.current.push({ kind: "reasoning", text: chunk });
        schedulePendingStreamFlush();
        return;
      }

      if (ev.event === "stream_end") {
        flushPendingStreamEvents({
          closeAnswerSegment: true,
          ...(typeof ev.text === "string" ? { finalAnswerText: ev.text } : {}),
        });
        if (suppressStreamUntilTurnEndRef.current) return;
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

      if (ev.event === "goal_state") {
        setGoalState(ev.goal_state);
        return;
      }

      if (ev.event === "goal_status") {
        if (ev.status === "running" && typeof ev.started_at === "number") {
          setRunStartedAt(ev.started_at);
        } else {
          setRunStartedAt(null);
          setIsStreaming(false);
          setMessages(closeOpenStreams);
        }
        return;
      }

      if (ev.event === "team_run_started") {
        const id = `team-run-${ev.run_id}`;
        const stagedMembers = ev.members.filter((member) => member.phase);
        const firstPhase = stagedMembers[0]?.phase;
        const firstPhaseCount = firstPhase
          ? stagedMembers.filter((member) => member.phase === firstPhase).length
          : ev.members.length;
        const steps = [
          ...ev.members.map((member) => ({
            id: member.id,
            title: `${member.name}${member.framework ? ` · ${member.framework}` : ""}`,
            detail: member.description || "团队已启动，正在分配研究任务",
            // The gateway emits this frame immediately before dispatching the
            // members. Showing an active state here keeps the UI truthful to
            // the running team even if a follow-up member frame is delayed.
            status: (!firstPhase || member.phase === firstPhase ? "running" : "pending") as TaskProgressStep["status"],
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
              note: firstPhase && firstPhaseCount < ev.members.length
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

      if (ev.event === "turn_end") {
        if ("goal_state" in ev && ev.goal_state != null && typeof ev.goal_state === "object") {
          setGoalState(ev.goal_state);
        }
        setRunStartedAt(null);
        // Definitive signal that the turn is fully complete.  Cancel any
        // pending debounce timer and stop the loading indicator immediately.
        if (streamEndTimerRef.current !== null) {
          clearTimeout(streamEndTimerRef.current);
          streamEndTimerRef.current = null;
        }
        setIsStreaming(false);
        setMessages((prev) => {
          let finalized = ev.finish_reason === "cancelled"
            ? finalizeInterruptedTurn(prev)
            : closeOpenStreams(prev);
          finalized = pruneReasoningOnlyPlaceholders(finalized);
          if (typeof ev.latency_ms === "number" && ev.latency_ms >= 0) {
            finalized = stampLastAssistantLatency(finalized, Math.round(ev.latency_ms));
          }
          buffer.current = null;
          activeAssistantRef.current = null;
          clearActivitySegment();
          closedAssistantStreamIdsRef.current.clear();
          return finalized;
        });
        suppressStreamUntilTurnEndRef.current = false;
        onTurnEnd?.();
        return;
      }

      if (ev.event === "message") {
        if (
          suppressStreamUntilTurnEndRef.current &&
          (ev.kind === "tool_hint" || ev.kind === "progress" || ev.kind === "reasoning")
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
            if (
              last
              && last.kind === "trace"
              && !last.isStreaming
              // Keep consecutive task-progress snapshots as separate timeline
              // moments. Tool start/end frames may still merge into either
              // snapshot through call_id, but a newer plan update must not
              // overwrite the earlier user-visible stage.
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

        // A complete (non-streamed) assistant message. If a stream was in
        // flight, drop the placeholder so we don't render the text twice.
        // Do NOT reset isStreaming here — only ``turn_end`` signals that
        // the full turn (all tool calls + final text) is complete.
        clearActivitySegment();
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
        return;
      }
      // ``attached`` / ``error`` frames aren't actionable here; the client
      // shell handles them separately.
    };

    const unsub = client.onChat(chatId, handle);
    return () => {
      unsub();
      buffer.current = null;
      activeAssistantRef.current = null;
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
          },
        ];
      });
      // Mark streaming immediately so the UI shows the loading indicator
      // right away, before the first delta arrives from the server.
      setIsStreaming(true);
      const wireMedia = hasImages ? images!.map((i) => i.media) : undefined;
      if (options) {
        client.sendMessage(chatId, content, wireMedia, options);
      } else {
        client.sendMessage(chatId, content, wireMedia);
      }
      return true;
    },
    [chatId, clearActivitySegment, client, flushPendingStreamEvents, setIsStreaming],
  );

  const stop = useCallback(() => {
    if (!chatId || !client) return;
    flushPendingStreamEvents();
    setIsStreaming(false);
    setRunStartedAt(null);
    setMessages((prev) => {
      buffer.current = null;
      activeAssistantRef.current = null;
      closedAssistantStreamIdsRef.current.clear();
      clearActivitySegment();
      return finalizeInterruptedTurn(prev);
    });
    suppressStreamUntilTurnEndRef.current = false;
    client.sendMessage(chatId, "/stop");
  }, [chatId, clearActivitySegment, client, flushPendingStreamEvents, setIsStreaming]);

  return {
    messages,
    isStreaming,
    runStartedAt,
    goalState,
    send,
    stop,
    setMessages,
    streamError,
    dismissStreamError,
  };
}
