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
});
