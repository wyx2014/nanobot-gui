import { describe, expect, it, vi } from "vitest";
import { NanobotClient, TranscriptionRequestError } from "./nanobot-client";

class FakeSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

describe("NanobotClient readiness", () => {
  it("keeps outbound messages queued until the gateway ready frame", async () => {
    const socket = new FakeSocket();
    const client = new NanobotClient({
      url: "ws://127.0.0.1:8900/",
      reconnect: false,
      socketFactory: () => socket as unknown as WebSocket,
    });

    client.connect();
    const ready = client.waitUntilReady();
    socket.open();
    client.sendMessage("chat-1", "hello");

    expect(client.status).toBe("connecting");
    expect(socket.send).not.toHaveBeenCalled();

    socket.receive({
      event: "ready",
      chat_id: "default-chat",
      client_id: "desktop",
      agent_ready: true,
      mcp_status: "warming",
    });
    await ready;

    expect(client.status).toBe("open");
    expect(client.mcpStatus).toBe("warming");
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"content":"hello"'));

    socket.receive({
      event: "runtime_status",
      agent_ready: true,
      mcp_status: "ready",
    });
    expect(client.mcpStatus).toBe("ready");
  });

  it("waits for the gateway acknowledgement when clearing an expert team", async () => {
    const socket = new FakeSocket();
    const client = new NanobotClient({
      url: "ws://127.0.0.1:8900/",
      reconnect: false,
      socketFactory: () => socket as unknown as WebSocket,
    });
    const sessionUpdates = vi.fn();
    client.onSessionUpdate(sessionUpdates);
    client.connect();
    socket.open();
    socket.receive({
      event: "ready",
      chat_id: "default-chat",
      client_id: "desktop",
      agent_ready: true,
      mcp_status: "ready",
    });

    const update = client.setExpertTeam("chat-1", null);
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({
      type: "set_expert_team",
      chat_id: "chat-1",
      expert_team: null,
    }));

    socket.receive({
      event: "session_updated",
      chat_id: "chat-1",
      scope: "metadata",
      expert_team: null,
    });

    await expect(update).resolves.toBeNull();
    expect(sessionUpdates).toHaveBeenCalledWith(
      "chat-1",
      "metadata",
      undefined,
      null,
      undefined,
      undefined,
    );
  });

  it("sends browser takeover controls through the authenticated socket", () => {
    const socket = new FakeSocket();
    const client = new NanobotClient({
      url: "ws://127.0.0.1:8900/",
      reconnect: false,
      socketFactory: () => socket as unknown as WebSocket,
    });
    client.connect();
    socket.open();
    socket.receive({
      event: "ready",
      chat_id: "default-chat",
      client_id: "desktop",
      agent_ready: true,
      mcp_status: "ready",
    });

    client.browserControl("chat-browser", "pause");

    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({
      type: "browser_control",
      chat_id: "chat-browser",
      action: "pause",
    }));
  });

  it("rejects an expert-team update when the gateway refuses it", async () => {
    const socket = new FakeSocket();
    const client = new NanobotClient({
      url: "ws://127.0.0.1:8900/",
      reconnect: false,
      socketFactory: () => socket as unknown as WebSocket,
    });
    client.connect();
    socket.open();
    socket.receive({
      event: "ready",
      chat_id: "default-chat",
      client_id: "desktop",
      agent_ready: true,
      mcp_status: "ready",
    });

    const update = client.setExpertTeam("chat-1", null);
    socket.receive({
      event: "error",
      chat_id: "chat-1",
      detail: "expert_team_rejected",
      reason: "chat_running",
    });

    await expect(update).rejects.toThrow("expert_team_rejected:chat_running");
  });

  it("uses the gateway attached id for a new conversation", async () => {
    const socket = new FakeSocket();
    const client = new NanobotClient({
      url: "ws://127.0.0.1:8900/",
      reconnect: false,
      socketFactory: () => socket as unknown as WebSocket,
    });
    client.connect();
    socket.open();
    socket.receive({
      event: "ready",
      chat_id: "default-chat",
      client_id: "desktop",
      agent_ready: true,
      mcp_status: "ready",
    });

    const created = client.newChat(5_000, {
      project_path: "/tmp/project",
      access_mode: "full",
    });
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({
      type: "new_chat",
      workspace_scope: {
        project_path: "/tmp/project",
        access_mode: "full",
      },
    }));

    socket.receive({ event: "attached", chat_id: "gateway-created-chat" });
    await expect(created).resolves.toBe("gateway-created-chat");
  });

  it("preserves runtime state across disconnect until a snapshot replaces it", () => {
    const socket = new FakeSocket();
    const client = new NanobotClient({
      url: "ws://127.0.0.1:8900/",
      reconnect: false,
      socketFactory: () => socket as unknown as WebSocket,
    });
    const runStatus = vi.fn();
    client.onRunStatus(runStatus);
    client.connect();
    socket.open();
    socket.receive({
      event: "ready",
      chat_id: "default-chat",
      client_id: "desktop",
      agent_ready: true,
      mcp_status: "ready",
    });
    socket.receive({
      event: "goal_status",
      chat_id: "chat-1",
      status: "running",
      started_at: 123,
    });

    expect(client.getRunStartedAt("chat-1")).toBe(123);
    socket.onclose?.({ code: 1006 });

    expect(client.getRunStartedAt("chat-1")).toBe(123);
    expect(runStatus).toHaveBeenLastCalledWith("chat-1", 123);
  });

  it("uses revisioned lifecycle snapshots and rejects stale patches", () => {
    const socket = new FakeSocket();
    const client = new NanobotClient({
      url: "ws://127.0.0.1:8900/",
      reconnect: false,
      socketFactory: () => socket as unknown as WebSocket,
    });
    const runStatus = vi.fn();
    client.onRunStatus(runStatus);
    client.connect();
    socket.open();
    socket.receive({
      event: "ready",
      chat_id: "default-chat",
      client_id: "desktop",
      agent_ready: true,
      mcp_status: "ready",
    });
    socket.receive({
      event: "turn_started",
      chat_id: "chat-1",
      snapshot_revision: 2,
      turn: {
        id: "turn-a",
        runtime_epoch: "epoch-a",
        status: "inProgress",
        started_at: 2_000,
      },
    });
    socket.receive({
      event: "thread_status_changed",
      chat_id: "chat-1",
      runtime_epoch: "epoch-a",
      snapshot_revision: 1,
      thread_status: { type: "idle" },
      active_turn: null,
      latest_turn: null,
    });

    expect(client.getRunStartedAt("chat-1")).toBe(2_000);

    socket.receive({
      event: "turn_completed",
      chat_id: "chat-1",
      snapshot_revision: 3,
      turn: {
        id: "turn-a",
        runtime_epoch: "epoch-a",
        status: "completed",
        started_at: 2_000,
        completed_at: 3_000,
        finish_reason: "success",
      },
    });
    expect(client.getRunStartedAt("chat-1")).toBeNull();
    expect(runStatus).toHaveBeenLastCalledWith("chat-1", null);
  });

  it("sends an audio transcription request and resolves its matching response", async () => {
    const socket = new FakeSocket();
    const client = new NanobotClient({
      url: "ws://127.0.0.1:8900/",
      reconnect: false,
      socketFactory: () => socket as unknown as WebSocket,
    });
    client.connect();
    socket.open();
    socket.receive({
      event: "ready",
      chat_id: "default-chat",
      client_id: "desktop",
      agent_ready: true,
      mcp_status: "ready",
    });

    const pending = client.transcribeAudio("data:audio/wav;base64,UklGRg==", 1200);
    const frame = JSON.parse(String(socket.send.mock.calls.at(-1)?.[0]));
    expect(frame).toMatchObject({
      type: "transcribe_audio",
      data_url: "data:audio/wav;base64,UklGRg==",
      duration_ms: 1200,
    });

    socket.receive({
      event: "transcription_result",
      request_id: frame.request_id,
      text: "语音输入成功",
    });

    await expect(pending).resolves.toBe("语音输入成功");
  });

  it("surfaces structured transcription configuration errors", async () => {
    const socket = new FakeSocket();
    const client = new NanobotClient({
      url: "ws://127.0.0.1:8900/",
      reconnect: false,
      socketFactory: () => socket as unknown as WebSocket,
    });
    client.connect();
    socket.open();
    socket.receive({
      event: "ready",
      chat_id: "default-chat",
      client_id: "desktop",
      agent_ready: true,
      mcp_status: "ready",
    });

    const pending = client.transcribeAudio("data:audio/wav;base64,UklGRg==");
    const frame = JSON.parse(String(socket.send.mock.calls.at(-1)?.[0]));
    socket.receive({
      event: "transcription_error",
      request_id: frame.request_id,
      detail: "not_configured",
      provider: "stepfun",
    });

    await expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<TranscriptionRequestError>>({
        detail: "not_configured",
        provider: "stepfun",
      }),
    );
  });

  it("streams PCM chunks and resolves the final realtime transcript", async () => {
    const socket = new FakeSocket();
    const client = new NanobotClient({
      url: "ws://127.0.0.1:8900/",
      reconnect: false,
      socketFactory: () => socket as unknown as WebSocket,
    });
    const onPartial = vi.fn();
    client.connect();
    socket.open();
    socket.receive({
      event: "ready",
      chat_id: "default-chat",
      client_id: "desktop",
      agent_ready: true,
      mcp_status: "ready",
    });

    const started = client.startVoiceStream("voice-test", { onPartial });
    expect(JSON.parse(String(socket.send.mock.calls.at(-1)?.[0]))).toEqual({
      type: "voice_stream_start",
      stream_id: "voice-test",
      sample_rate: 16000,
    });
    socket.receive({
      event: "voice_stream_state",
      stream_id: "voice-test",
      state: "listening",
      mode: "realtime",
    });
    await expect(started).resolves.toBe("realtime");

    client.appendVoiceAudio(
      "voice-test",
      new Uint8Array([1, 2, 3, 4]).buffer,
      0,
      40,
    );
    expect(JSON.parse(String(socket.send.mock.calls.at(-1)?.[0]))).toMatchObject({
      type: "voice_audio_chunk",
      stream_id: "voice-test",
      sequence: 0,
      duration_ms: 40,
      audio: "AQIDBA==",
    });

    socket.receive({
      event: "voice_transcript_partial",
      stream_id: "voice-test",
      text: "帮我分析",
    });
    expect(onPartial).toHaveBeenCalledWith("帮我分析", false);

    const stopped = client.stopVoiceStream("voice-test");
    socket.receive({
      event: "voice_transcript_final",
      stream_id: "voice-test",
      text: "帮我分析青岛啤酒",
    });
    await expect(stopped).resolves.toBe("帮我分析青岛啤酒");
  });
});
