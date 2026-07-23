import { describe, expect, it, vi } from "vitest";
import { NanobotClient } from "./nanobot-client";

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
    expect(sessionUpdates).toHaveBeenCalledWith("chat-1", "metadata", undefined, null);
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
});
