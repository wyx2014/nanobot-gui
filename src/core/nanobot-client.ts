import type {
  BootstrapResponse,
  ConnectionStatus,
  ExpertTeamBinding,
  InboundEvent,
  Outbound,
  OutboundCliAppMention,
  OutboundImageGeneration,
  OutboundSkillScope,
  UIInteractivePromptAnswer,
  OutboundMcpPresetMention,
  OutboundMedia,
  GoalStateWsPayload,
  WorkspaceScopePayload,
  ThreadRuntimeSnapshot,
} from "./types";

const WS_OPEN = 1;
const WS_CLOSING = 2;

function createDefaultSocket(url: string): WebSocket {
  return new WebSocket(url);
}

function wsInboundDebugEnabled(): boolean {
  if (typeof globalThis === "undefined") return false;
  try {
    const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    const raw = ls?.getItem("nanobot_debug_ws")?.trim().toLowerCase() ?? "";
    if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
      return false;
    }
    if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") {
      return true;
    }
    return true; // Enabled by default in GUI
  } catch {
    return true;
  }
}

function summarizeInboundWsPayload(ev: InboundEvent): unknown {
  const kind = (ev as { event?: string }).event;
  if (kind === "browser_frame") {
    const frame = ev as Extract<InboundEvent, { event: "browser_frame" }>;
    return {
      ...frame,
      image_base64: `[base64 ${frame.image_base64.length} chars]`,
    };
  }
  if (kind !== "delta" && kind !== "reasoning_delta" && kind !== "narration_delta") return ev;
  const row = { ...(ev as object) } as Record<string, unknown>;
  const text = typeof row.text === "string" ? row.text : "";
  const max = 240;
  if (text.length > max) {
    row.text = `${text.slice(0, max)}… (${text.length} chars)`;
  }
  return row;
}

type Unsubscribe = () => void;
type EventHandler = (ev: InboundEvent) => void;
type StatusHandler = (status: ConnectionStatus) => void;
type RuntimeStatusHandler = (
  agentReady: boolean,
  mcpStatus: NonNullable<BootstrapResponse["mcp_status"]>,
) => void;
type RuntimeModelHandler = (modelName: string | null, modelPreset?: string | null) => void;
type SessionUpdateScope = "metadata" | "thread" | string;
type SessionUpdateHandler = (
  chatId: string,
  scope?: SessionUpdateScope,
  workspaceScope?: WorkspaceScopePayload,
  expertTeam?: ExpertTeamBinding | null,
  sessionId?: string,
  projectId?: string,
) => void;
type RunStatusHandler = (chatId: string, startedAt: number | null) => void;
type RuntimeSnapshotHandler = (
  chatId: string,
  snapshot: ThreadRuntimeSnapshot,
) => void;
type RuntimeSnapshotGapHandler = (chatId: string) => void;

export type StreamError =
  | { kind: "message_too_big" }
  | { kind: "workspace_scope_rejected"; reason?: string; chatId?: string }
  | { kind: "workspace_access_required"; reason?: string; chatId?: string };

type ErrorHandler = (error: StreamError) => void;

interface PendingNewChat {
  resolve: (chatId: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingExpertTeamUpdate {
  resolve: (team: ExpertTeamBinding | null) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingTranscription {
  resolve: (text: string) => void;
  reject: (err: TranscriptionRequestError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type VoiceStreamMode = "realtime" | "batch";
export type VoiceStreamState = "listening" | "finalizing" | "done";

export interface VoiceStreamCallbacks {
  onState?: (state: VoiceStreamState, mode: VoiceStreamMode) => void;
  onPartial?: (text: string, stable: boolean) => void;
  onFinal?: (text: string) => void;
  onError?: (error: VoiceStreamError) => void;
}

interface ActiveVoiceStream {
  callbacks: VoiceStreamCallbacks;
  mode?: VoiceStreamMode;
  startResolve: (mode: VoiceStreamMode) => void;
  startReject: (error: VoiceStreamError) => void;
  startTimer: ReturnType<typeof setTimeout>;
  stopResolve?: (text: string) => void;
  stopReject?: (error: VoiceStreamError) => void;
  stopTimer?: ReturnType<typeof setTimeout>;
}

export class TranscriptionRequestError extends Error {
  readonly detail: string;
  readonly provider?: string;

  constructor(
    detail: string,
    provider?: string,
  ) {
    super(detail);
    this.name = "TranscriptionRequestError";
    this.detail = detail;
    this.provider = provider;
  }
}

export class VoiceStreamError extends Error {
  readonly detail: string;
  readonly provider?: string;
  readonly recoverable: boolean;

  constructor(detail: string, provider?: string, recoverable: boolean = false) {
    super(detail);
    this.name = "VoiceStreamError";
    this.detail = detail;
    this.provider = provider;
    this.recoverable = recoverable;
  }
}

export interface NanobotClientOptions {
  url: string;
  reconnect?: boolean;
  onReauth?: () => Promise<string | null>;
  socketFactory?: (url: string) => WebSocket;
  maxBackoffMs?: number;
}

export class NanobotClient {
  private socket: WebSocket | null = null;
  private statusHandlers = new Set<StatusHandler>();
  private runtimeStatusHandlers = new Set<RuntimeStatusHandler>();
  private runtimeModelHandlers = new Set<RuntimeModelHandler>();
  private sessionUpdateHandlers = new Set<SessionUpdateHandler>();
  private runStatusHandlers = new Set<RunStatusHandler>();
  private runtimeSnapshotHandlers = new Set<RuntimeSnapshotHandler>();
  private runtimeSnapshotGapHandlers = new Set<RuntimeSnapshotGapHandler>();
  private errorHandlers = new Set<ErrorHandler>();
  private chatHandlers = new Map<string, Set<EventHandler>>();
  private pendingInboundByChat = new Map<string, InboundEvent[]>();
  private static readonly PENDING_INBOUND_MAX = 2000;
  private knownChats = new Set<string>();
  private runStartedAtByChatId = new Map<string, number>();
  private runtimeSnapshotByChatId = new Map<string, ThreadRuntimeSnapshot>();
  private goalStateByChatId = new Map<string, GoalStateWsPayload>();
  private pendingNewChat: PendingNewChat | null = null;
  private pendingExpertTeamUpdates = new Map<string, PendingExpertTeamUpdate>();
  private pendingTranscriptions = new Map<string, PendingTranscription>();
  private voiceStreams = new Map<string, ActiveVoiceStream>();
  private sendQueue: Outbound[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly shouldReconnect: boolean;
  private readonly maxBackoffMs: number;
  private socketFactory: (url: string) => WebSocket;
  private currentUrl: string;
  private status_: ConnectionStatus = "idle";
  private agentReady_ = false;
  private mcpStatus_: NonNullable<BootstrapResponse["mcp_status"]> = "unknown";
  private readyChatId: string | null = null;
  private intentionallyClosed = false;
  private options: NanobotClientOptions;

  constructor(options: NanobotClientOptions) {
    this.options = options;
    this.shouldReconnect = options.reconnect ?? true;
    this.maxBackoffMs = options.maxBackoffMs ?? 15_000;
    this.socketFactory = options.socketFactory ?? createDefaultSocket;
    this.currentUrl = options.url;
  }

  get status(): ConnectionStatus {
    return this.status_;
  }

  get defaultChatId(): string | null {
    return this.readyChatId;
  }

  get mcpStatus(): NonNullable<BootstrapResponse["mcp_status"]> {
    return this.mcpStatus_;
  }

  updateUrl(url: string, socketFactory?: (url: string) => WebSocket): void {
    this.currentUrl = url;
    if (socketFactory) {
      this.socketFactory = socketFactory;
    }
  }

  onStatus(handler: StatusHandler): Unsubscribe {
    this.statusHandlers.add(handler);
    handler(this.status_);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  onRuntimeStatus(handler: RuntimeStatusHandler): Unsubscribe {
    this.runtimeStatusHandlers.add(handler);
    handler(this.agentReady_, this.mcpStatus_);
    return () => {
      this.runtimeStatusHandlers.delete(handler);
    };
  }

  onRuntimeModelUpdate(handler: RuntimeModelHandler): Unsubscribe {
    this.runtimeModelHandlers.add(handler);
    return () => {
      this.runtimeModelHandlers.delete(handler);
    };
  }

  onSessionUpdate(handler: SessionUpdateHandler): Unsubscribe {
    this.sessionUpdateHandlers.add(handler);
    return () => {
      this.sessionUpdateHandlers.delete(handler);
    };
  }

  onRunStatus(handler: RunStatusHandler): Unsubscribe {
    this.runStatusHandlers.add(handler);
    for (const [chatId, startedAt] of this.runStartedAtByChatId) {
      handler(chatId, startedAt);
    }
    return () => {
      this.runStatusHandlers.delete(handler);
    };
  }

  onRuntimeSnapshot(handler: RuntimeSnapshotHandler): Unsubscribe {
    this.runtimeSnapshotHandlers.add(handler);
    for (const [chatId, snapshot] of this.runtimeSnapshotByChatId) {
      handler(chatId, snapshot);
    }
    return () => {
      this.runtimeSnapshotHandlers.delete(handler);
    };
  }

  onRuntimeSnapshotGap(handler: RuntimeSnapshotGapHandler): Unsubscribe {
    this.runtimeSnapshotGapHandlers.add(handler);
    return () => {
      this.runtimeSnapshotGapHandlers.delete(handler);
    };
  }

  onError(handler: ErrorHandler): Unsubscribe {
    this.errorHandlers.add(handler);
    return () => {
      this.errorHandlers.delete(handler);
    };
  }

  getRunStartedAt(chatId: string): number | null {
    const v = this.runStartedAtByChatId.get(chatId);
    return v === undefined ? null : v;
  }

  getGoalState(chatId: string): GoalStateWsPayload | undefined {
    return this.goalStateByChatId.get(chatId);
  }

  getRuntimeSnapshot(chatId: string): ThreadRuntimeSnapshot | undefined {
    return this.runtimeSnapshotByChatId.get(chatId);
  }

  applyRuntimeSnapshot(chatId: string, snapshot: ThreadRuntimeSnapshot): boolean {
    const previous = this.runtimeSnapshotByChatId.get(chatId);
    const sameEpoch = previous?.runtime_epoch === snapshot.runtime_epoch;
    if (
      previous
      && sameEpoch
      && snapshot.snapshot_revision < previous.snapshot_revision
    ) {
      return false;
    }
    const hasRevisionGap = Boolean(
      previous
      && sameEpoch
      && snapshot.snapshot_revision > previous.snapshot_revision + 1
    );
    this.runtimeSnapshotByChatId.set(chatId, snapshot);
    for (const handler of this.runtimeSnapshotHandlers) {
      handler(chatId, snapshot);
    }
    const startedAt = snapshot.active_turn?.status === "inProgress"
      ? snapshot.active_turn.started_at
      : null;
    const oldStartedAt = this.runStartedAtByChatId.get(chatId) ?? null;
    if (startedAt == null) {
      this.runStartedAtByChatId.delete(chatId);
    } else {
      this.runStartedAtByChatId.set(chatId, startedAt);
    }
    if (oldStartedAt !== startedAt) {
      this.emitRunStatus(chatId, startedAt);
    }
    if (hasRevisionGap) {
      for (const handler of this.runtimeSnapshotGapHandlers) {
        handler(chatId);
      }
    }
    return true;
  }

  private recordGoalStatusForRunStrip(chatId: string, ev: InboundEvent): void {
    if (
      ev.event === "turn_started"
      || ev.event === "turn_completed"
      || ev.event === "thread_status_changed"
    ) {
      const previous = this.runtimeSnapshotByChatId.get(chatId);
      const runtimeEpoch = (
        ev.event === "thread_status_changed"
          ? ev.runtime_epoch
          : ev.turn.runtime_epoch
      ) ?? previous?.runtime_epoch ?? null;
      const snapshot: ThreadRuntimeSnapshot = ev.event === "turn_started"
        ? {
            session_key: `websocket:${chatId}`,
            runtime_epoch: runtimeEpoch,
            snapshot_revision: ev.snapshot_revision,
            thread_status: { type: "active", active_flags: [] },
            active_turn: ev.turn,
            latest_turn: previous?.latest_turn ?? null,
          }
        : ev.event === "turn_completed"
          ? {
              session_key: `websocket:${chatId}`,
              runtime_epoch: runtimeEpoch,
              snapshot_revision: ev.snapshot_revision,
              thread_status: { type: "idle" },
              active_turn: null,
              latest_turn: ev.turn,
            }
          : {
              session_key: `websocket:${chatId}`,
              runtime_epoch: runtimeEpoch,
              snapshot_revision: ev.snapshot_revision,
              thread_status: ev.thread_status,
              active_turn: ev.active_turn ?? (
                ev.thread_status.type === "active" ? previous?.active_turn ?? null : null
              ),
              latest_turn: ev.latest_turn ?? previous?.latest_turn ?? null,
            };
      this.applyRuntimeSnapshot(chatId, snapshot);
      return;
    }
    // Once v2 runtime state has been observed, legacy goal/turn frames are
    // display compatibility only and may not mutate authoritative run state.
    if (this.runtimeSnapshotByChatId.has(chatId)) return;
    if (ev.event === "turn_end") {
      if (this.runStartedAtByChatId.has(chatId)) {
        this.runStartedAtByChatId.delete(chatId);
        this.emitRunStatus(chatId, null);
      }
      return;
    }
    if (ev.event !== "goal_status") return;
    if (ev.status === "running" && typeof ev.started_at === "number") {
      const previous = this.runStartedAtByChatId.get(chatId);
      this.runStartedAtByChatId.set(chatId, ev.started_at);
      if (previous !== ev.started_at) this.emitRunStatus(chatId, ev.started_at);
    } else if (this.runStartedAtByChatId.has(chatId)) {
      this.runStartedAtByChatId.delete(chatId);
      this.emitRunStatus(chatId, null);
    }
  }

  private recordGoalStateSnapshot(chatId: string, ev: InboundEvent): void {
    if (ev.event === "goal_state") {
      this.goalStateByChatId.set(chatId, ev.goal_state);
      return;
    }
    if (ev.event === "turn_end" && ev.goal_state != null && typeof ev.goal_state === "object") {
      this.goalStateByChatId.set(chatId, ev.goal_state);
    }
  }

  onChat(chatId: string, handler: EventHandler): Unsubscribe {
    let handlers = this.chatHandlers.get(chatId);
    if (!handlers) {
      handlers = new Set();
      this.chatHandlers.set(chatId, handlers);
    }
    handlers.add(handler);
    const pending = this.pendingInboundByChat.get(chatId);
    if (pending !== undefined && pending.length > 0) {
      const flushed = pending.splice(0);
      this.pendingInboundByChat.delete(chatId);
      for (const ev of flushed) {
        handler(ev);
      }
    }
    this.attach(chatId);
    return () => {
      const current = this.chatHandlers.get(chatId);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.chatHandlers.delete(chatId);
    };
  }

  connect(): void {
    if (this.socket && this.socket.readyState < WS_CLOSING) return;
    this.intentionallyClosed = false;
    this.setStatus("connecting");
    const sock = this.socketFactory(this.currentUrl);
    this.socket = sock;
    sock.onopen = () => this.handleOpen();
    sock.onmessage = (ev) => this.handleMessage(ev);
    sock.onerror = () => this.setStatus("error");
    sock.onclose = (ev) => this.handleClose(ev);
  }

  waitUntilReady(timeoutMs: number = 10_000): Promise<void> {
    if (this.status_ === "open") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let unsubscribe: Unsubscribe | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        unsubscribe?.();
        if (error) reject(error);
        else resolve();
      };
      unsubscribe = this.onStatus((status) => {
        if (status === "open") finish();
        else if (status === "closed") finish(new Error("socket closed before ready"));
      });
      if (settled) {
        unsubscribe();
        return;
      }
      timer = setTimeout(
        () => finish(new Error(`WebSocket did not become ready within ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
  }

  close(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const sock = this.socket;
    this.socket = null;
    try {
      sock?.close();
    } catch {
      // ignore
    }
    this.setStatus("closed");
  }

  newChat(
    timeoutMs: number = 5_000,
    workspaceScope?: WorkspaceScopePayload | null,
    expertTeam?: ExpertTeamBinding,
  ): Promise<string> {
    if (this.pendingNewChat) {
      return Promise.reject(new Error("newChat already in flight"));
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingNewChat = null;
        reject(new Error("newChat timed out"));
      }, timeoutMs);
      this.pendingNewChat = { resolve, reject, timer };
      this.queueSend({
        type: "new_chat",
        ...(workspaceScope ? { workspace_scope: workspaceScope } : {}),
        ...(expertTeam ? { expert_team: expertTeam } : {}),
      });
    });
  }

  attach(chatId: string): void {
    this.knownChats.add(chatId);
    if (this.socket?.readyState === WS_OPEN) {
      this.queueSend({ type: "attach", chat_id: chatId });
    }
  }

  sendMessage(
    chatId: string,
    content: string,
    media?: OutboundMedia[],
    options?: {
      imageGeneration?: OutboundImageGeneration;
      cliApps?: OutboundCliAppMention[];
      mcpPresets?: OutboundMcpPresetMention[];
      skillScope?: OutboundSkillScope;
      workspaceScope?: WorkspaceScopePayload | null;
      interactivePromptAnswer?: UIInteractivePromptAnswer;
      expertTeam?: ExpertTeamBinding;
    },
  ): void {
    this.knownChats.add(chatId);
    const frame: Outbound = {
      type: "message",
      chat_id: chatId,
      content,
      ...(media && media.length > 0 ? { media } : {}),
      ...(options?.imageGeneration ? { image_generation: options.imageGeneration } : {}),
      ...(options?.cliApps?.length ? { cli_apps: options.cliApps } : {}),
      ...(options?.mcpPresets?.length ? { mcp_presets: options.mcpPresets } : {}),
      ...(options?.skillScope ? { skill_scope: options.skillScope } : {}),
      ...(options?.workspaceScope ? { workspace_scope: options.workspaceScope } : {}),
      ...(options?.interactivePromptAnswer ? { interactive_prompt_answer: options.interactivePromptAnswer } : {}),
      ...(options?.expertTeam ? { expert_team: options.expertTeam } : {}),
      webui: true,
    };
    this.queueSend(frame);
  }

  setWorkspaceScope(chatId: string, workspaceScope: WorkspaceScopePayload): void {
    this.knownChats.add(chatId);
    this.queueSend({
      type: "set_workspace_scope",
      chat_id: chatId,
      workspace_scope: workspaceScope,
    });
  }

  browserControl(
    chatId: string,
    action: "pause" | "resume" | "stop" | "capture",
  ): void {
    this.knownChats.add(chatId);
    this.queueSend({
      type: "browser_control",
      chat_id: chatId,
      action,
    });
  }

  setExpertTeam(
    chatId: string,
    expertTeam: ExpertTeamBinding | null,
    timeoutMs: number = 5_000,
  ): Promise<ExpertTeamBinding | null> {
    if (this.pendingExpertTeamUpdates.has(chatId)) {
      return Promise.reject(new Error("expert team update already in flight"));
    }
    this.knownChats.add(chatId);
    return new Promise<ExpertTeamBinding | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingExpertTeamUpdates.delete(chatId);
        reject(new Error("expert team update timed out"));
      }, timeoutMs);
      this.pendingExpertTeamUpdates.set(chatId, { resolve, reject, timer });
      this.queueSend({
        type: "set_expert_team",
        chat_id: chatId,
        expert_team: expertTeam,
      });
    });
  }

  transcribeAudio(
    dataUrl: string,
    durationMs?: number,
    timeoutMs: number = 90_000,
  ): Promise<string> {
    const requestId = globalThis.crypto?.randomUUID?.()
      ?? `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingTranscriptions.delete(requestId);
        reject(new TranscriptionRequestError("timeout"));
      }, timeoutMs);
      this.pendingTranscriptions.set(requestId, { resolve, reject, timer });
      this.queueSend({
        type: "transcribe_audio",
        request_id: requestId,
        data_url: dataUrl,
        ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
      });
    });
  }

  startVoiceStream(
    streamId: string,
    callbacks: VoiceStreamCallbacks = {},
    timeoutMs: number = 12_000,
  ): Promise<VoiceStreamMode> {
    if (this.voiceStreams.has(streamId)) {
      return Promise.reject(new VoiceStreamError("already_started"));
    }
    return new Promise<VoiceStreamMode>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.voiceStreams.delete(streamId);
        reject(new VoiceStreamError("timeout"));
      }, timeoutMs);
      this.voiceStreams.set(streamId, {
        callbacks,
        startResolve: resolve,
        startReject: reject,
        startTimer: timer,
      });
      this.queueSend({
        type: "voice_stream_start",
        stream_id: streamId,
        sample_rate: 16000,
      });
    });
  }

  appendVoiceAudio(
    streamId: string,
    chunk: ArrayBuffer,
    sequence: number,
    durationMs: number,
  ): void {
    const bytes = new Uint8Array(chunk);
    let binary = "";
    const sliceSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += sliceSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + sliceSize));
    }
    this.queueSend({
      type: "voice_audio_chunk",
      stream_id: streamId,
      sequence,
      audio: btoa(binary),
      duration_ms: durationMs,
    });
  }

  stopVoiceStream(streamId: string, timeoutMs: number = 12_000): Promise<string> {
    const active = this.voiceStreams.get(streamId);
    if (!active) return Promise.reject(new VoiceStreamError("not_started"));
    if (active.stopResolve) return Promise.reject(new VoiceStreamError("already_stopping"));
    return new Promise<string>((resolve, reject) => {
      active.stopResolve = resolve;
      active.stopReject = reject;
      active.stopTimer = setTimeout(() => {
        this.voiceStreams.delete(streamId);
        reject(new VoiceStreamError("timeout", undefined, true));
      }, timeoutMs);
      this.queueSend({ type: "voice_stream_stop", stream_id: streamId });
    });
  }

  cancelVoiceStream(streamId: string): void {
    const active = this.voiceStreams.get(streamId);
    if (active) {
      clearTimeout(active.startTimer);
      if (active.stopTimer) clearTimeout(active.stopTimer);
      this.voiceStreams.delete(streamId);
    }
    this.queueSend({ type: "voice_stream_cancel", stream_id: streamId });
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status_ === status) return;
    this.status_ = status;
    for (const handler of this.statusHandlers) handler(status);
  }

  private handleOpen(): void {
    this.reconnectAttempts = 0;
  }

  private handleMessage(ev: MessageEvent): void {
    let parsed: InboundEvent;
    try {
      parsed = JSON.parse(typeof ev.data === "string" ? ev.data : "") as InboundEvent;
    } catch {
      if (wsInboundDebugEnabled()) {
        const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
        console.warn(
          "[nanobot ws inbound] invalid JSON",
          raw.length > 400 ? `${raw.slice(0, 400)}… (${raw.length} chars)` : raw,
        );
      }
      return;
    }

    if (wsInboundDebugEnabled()) {
      console.log("[nanobot ws inbound]", summarizeInboundWsPayload(parsed));
    }

    if (parsed.event === "ready") {
      this.readyChatId = parsed.chat_id;
      this.updateRuntimeStatus(parsed.agent_ready !== false, parsed.mcp_status);
      for (const chatId of this.knownChats) {
        this.rawSend({ type: "attach", chat_id: chatId });
      }
      this.knownChats.add(parsed.chat_id);
      this.setStatus("open");
      const queued = this.sendQueue.splice(0);
      for (const frame of queued) this.rawSend(frame);
      return;
    }

    if (parsed.event === "runtime_status") {
      this.updateRuntimeStatus(parsed.agent_ready, parsed.mcp_status);
      return;
    }

    if (parsed.event === "transcription_result" || parsed.event === "transcription_error") {
      const requestId = parsed.request_id;
      if (!requestId) return;
      const pending = this.pendingTranscriptions.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingTranscriptions.delete(requestId);
      if (parsed.event === "transcription_result") {
        pending.resolve(parsed.text);
      } else {
        pending.reject(new TranscriptionRequestError(parsed.detail, parsed.provider));
      }
      return;
    }

    if (
      parsed.event === "voice_stream_state"
      || parsed.event === "voice_transcript_partial"
      || parsed.event === "voice_transcript_stable"
      || parsed.event === "voice_transcript_final"
      || parsed.event === "voice_stream_error"
    ) {
      const streamId = parsed.stream_id;
      if (!streamId) return;
      const active = this.voiceStreams.get(streamId);
      if (!active) return;
      if (parsed.event === "voice_stream_state") {
        active.mode = parsed.mode;
        active.callbacks.onState?.(parsed.state, parsed.mode);
        if (parsed.state === "listening") {
          clearTimeout(active.startTimer);
          active.startResolve(parsed.mode);
        } else if (parsed.state === "done" && parsed.outcome === "cancelled") {
          clearTimeout(active.startTimer);
          if (active.stopTimer) clearTimeout(active.stopTimer);
          this.voiceStreams.delete(streamId);
        }
      } else if (
        parsed.event === "voice_transcript_partial"
        || parsed.event === "voice_transcript_stable"
      ) {
        active.callbacks.onPartial?.(
          parsed.text,
          parsed.event === "voice_transcript_stable",
        );
      } else if (parsed.event === "voice_transcript_final") {
        clearTimeout(active.startTimer);
        if (active.stopTimer) clearTimeout(active.stopTimer);
        active.callbacks.onFinal?.(parsed.text);
        active.stopResolve?.(parsed.text);
        this.voiceStreams.delete(streamId);
      } else {
        const error = new VoiceStreamError(
          parsed.detail,
          parsed.provider,
          parsed.recoverable,
        );
        clearTimeout(active.startTimer);
        if (active.stopTimer) clearTimeout(active.stopTimer);
        active.callbacks.onError?.(error);
        active.startReject(error);
        active.stopReject?.(error);
        this.voiceStreams.delete(streamId);
      }
      return;
    }

    if (parsed.event === "attached") {
      this.knownChats.add(parsed.chat_id);
      if (this.pendingNewChat) {
        clearTimeout(this.pendingNewChat.timer);
        this.pendingNewChat.resolve(parsed.chat_id);
        this.pendingNewChat = null;
      }
      this.dispatch(parsed.chat_id, parsed);
      return;
    }

    if (parsed.event === "runtime_model_updated") {
      this.emitRuntimeModelUpdate(parsed.model_name || null, parsed.model_preset ?? null);
      return;
    }

    if (parsed.event === "session_updated") {
      this.emitSessionUpdate(
        parsed.chat_id,
        parsed.scope,
        parsed.workspace_scope,
        parsed.expert_team,
        parsed.session_id,
        parsed.project_id,
      );
      if (Object.prototype.hasOwnProperty.call(parsed, "expert_team")) {
        const pending = this.pendingExpertTeamUpdates.get(parsed.chat_id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingExpertTeamUpdates.delete(parsed.chat_id);
          pending.resolve(parsed.expert_team ?? null);
        }
      }
      return;
    }

    if (parsed.event === "error" && parsed.detail === "expert_team_rejected" && parsed.chat_id) {
      const pending = this.pendingExpertTeamUpdates.get(parsed.chat_id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingExpertTeamUpdates.delete(parsed.chat_id);
        pending.reject(new Error(`expert_team_rejected:${parsed.reason || ""}`));
        return;
      }
    }

    if (parsed.event === "error" && parsed.detail === "workspace_scope_rejected") {
      this.emitError({
        kind: "workspace_scope_rejected",
        reason: parsed.reason,
        chatId: parsed.chat_id,
      });
      if (this.pendingNewChat) {
        clearTimeout(this.pendingNewChat.timer);
        this.pendingNewChat.reject(new Error(`workspace_scope_rejected:${parsed.reason || ""}`));
        this.pendingNewChat = null;
      }
    }

    const chatId = (parsed as { chat_id?: string }).chat_id;
    if (chatId) {
      this.recordGoalStatusForRunStrip(chatId, parsed);
      this.recordGoalStateSnapshot(chatId, parsed);
      this.dispatch(chatId, parsed);
    }
  }

  private emitRuntimeModelUpdate(modelName: string | null, modelPreset?: string | null): void {
    for (const handler of this.runtimeModelHandlers) {
      handler(modelName, modelPreset);
    }
  }

  private updateRuntimeStatus(
    agentReady: boolean,
    mcpStatus?: BootstrapResponse["mcp_status"],
  ): void {
    this.agentReady_ = agentReady;
    this.mcpStatus_ = mcpStatus ?? "unknown";
    for (const handler of this.runtimeStatusHandlers) {
      handler(this.agentReady_, this.mcpStatus_);
    }
  }

  private emitSessionUpdate(
    chatId: string,
    scope?: SessionUpdateScope,
    workspaceScope?: WorkspaceScopePayload,
    expertTeam?: ExpertTeamBinding | null,
    sessionId?: string,
    projectId?: string,
  ): void {
    for (const handler of this.sessionUpdateHandlers) {
      handler(chatId, scope, workspaceScope, expertTeam, sessionId, projectId);
    }
  }

  private emitRunStatus(chatId: string, startedAt: number | null): void {
    for (const handler of this.runStatusHandlers) {
      handler(chatId, startedAt);
    }
  }

  private dispatch(chatId: string, ev: InboundEvent): void {
    const handlers = this.chatHandlers.get(chatId);
    if (handlers !== undefined && handlers.size > 0) {
      for (const h of handlers) {
        h(ev);
      }
      return;
    }
    let q = this.pendingInboundByChat.get(chatId);
    if (!q) {
      q = [];
      this.pendingInboundByChat.set(chatId, q);
    }
    q.push(ev);
    const over = q.length - NanobotClient.PENDING_INBOUND_MAX;
    if (over > 0) {
      q.splice(0, over);
    }
  }

  private handleClose(event?: { code?: number }): void {
    this.socket = null;
    // Preserve the last revision across reconnect. The HTTP Runtime Snapshot
    // will authoritatively replace it after re-authentication; socket closure
    // by itself is not a turn terminal event.
    if (this.pendingNewChat) {
      clearTimeout(this.pendingNewChat.timer);
      this.pendingNewChat.reject(new Error("socket closed"));
      this.pendingNewChat = null;
    }
    for (const pending of this.pendingExpertTeamUpdates.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("socket closed"));
    }
    this.pendingExpertTeamUpdates.clear();
    for (const pending of this.pendingTranscriptions.values()) {
      clearTimeout(pending.timer);
      pending.reject(new TranscriptionRequestError("socket_closed"));
    }
    this.pendingTranscriptions.clear();
    for (const active of this.voiceStreams.values()) {
      clearTimeout(active.startTimer);
      if (active.stopTimer) clearTimeout(active.stopTimer);
      const error = new VoiceStreamError("socket_closed", undefined, true);
      active.startReject(error);
      active.stopReject?.(error);
      active.callbacks.onError?.(error);
    }
    this.voiceStreams.clear();
    if (event?.code === 1009) {
      this.emitError({ kind: "message_too_big" });
    }
    if (this.intentionallyClosed || !this.shouldReconnect) {
      this.setStatus("closed");
      return;
    }
    this.scheduleReconnect();
  }

  private emitError(error: StreamError): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch {
        // ignore
      }
    }
  }

  private scheduleReconnect(): void {
    this.setStatus("reconnecting");
    const attempt = this.reconnectAttempts++;
    const delay = Math.min(500 * 2 ** attempt, this.maxBackoffMs);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.options.onReauth) {
        try {
          const refreshed = await this.options.onReauth();
          if (refreshed) this.currentUrl = refreshed;
        } catch {
          // fall through
        }
      }
      this.connect();
    }, delay);
  }

  private queueSend(frame: Outbound): void {
    if (this.socket?.readyState === WS_OPEN && this.status_ === "open") {
      this.rawSend(frame);
    } else {
      this.sendQueue.push(frame);
    }
  }

  private rawSend(frame: Outbound): void {
    if (!this.socket) return;
    try {
      this.socket.send(JSON.stringify(frame));
    } catch {
      this.sendQueue.push(frame);
    }
  }
}
