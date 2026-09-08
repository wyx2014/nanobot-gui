import { afterEach, describe, expect, it, vi } from "vitest";
import { NanobotClient } from "./nanobot-client";

class Socket {
  readyState = 1;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  receive(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }
}
const clients: NanobotClient[] = [];
function connected() {
  const socket = new Socket();
  const client = new NanobotClient({
    url: "ws://localhost/",
    reconnect: false,
    socketFactory: () => socket as unknown as WebSocket,
  });
  client.connect();
  socket.receive({ event: "ready", chat_id: "test", client_id: "desktop" });
  clients.push(client);
  return { client, socket };
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
  vi.useRealTimers();
});

describe("MCP management transport", () => {
  it("sends large structured configuration and correlates concurrent results", async () => {
    const { client, socket } = connected();
    const save = client.mcpSettings("save", {
      headers_patch: { Token: "x".repeat(16000) },
    });
    const first = JSON.parse(socket.send.mock.lastCall![0]);
    expect(first.values.headers_patch.Token).toHaveLength(16000);
    const list = client.mcpSettings("list");
    const second = JSON.parse(socket.send.mock.lastCall![0]);
    socket.receive({
      event: "mcp_settings_result",
      request_id: second.request_id,
      result: { presets: [], installed_count: 0 },
    });
    await expect(list).resolves.toMatchObject({ installed_count: 0 });
    socket.receive({
      event: "mcp_settings_result",
      request_id: first.request_id,
      error: "Name conflict",
      status: 409,
    });
    await expect(save).rejects.toThrow("Name conflict");
  });

  it("cancels a probe and ignores its late result", async () => {
    const { client, socket } = connected();
    const controller = new AbortController();
    const probe = client.mcpSettings("probe", {}, controller.signal);
    const { request_id } = JSON.parse(socket.send.mock.lastCall![0]);
    controller.abort();
    await expect(probe).rejects.toMatchObject({ name: "AbortError" });
    expect(JSON.parse(socket.send.mock.lastCall![0])).toEqual({
      type: "mcp_settings_cancel",
      request_id,
    });
    socket.receive({
      event: "mcp_settings_result",
      request_id,
      result: { presets: [] },
    });
  });

  it("rejects closed sockets and never queues failed mutations for replay", async () => {
    const { client, socket } = connected();
    socket.send.mockImplementationOnce(() => {
      throw new Error("closed");
    });
    await expect(client.mcpSettings("save")).rejects.toThrow("Could not send");
    socket.receive({ event: "ready", chat_id: "test", client_id: "desktop" });
    expect(
      socket.send.mock.calls.filter(
        ([raw]) => JSON.parse(raw).type === "mcp_settings",
      ),
    ).toHaveLength(1);
    const pending = client.mcpSettings("list");
    client.close();
    await expect(pending).rejects.toThrow("disconnected");
    await expect(client.mcpSettings("save")).rejects.toThrow("disconnected");
  });

  it("times out without replay and releases the pending request", async () => {
    vi.useFakeTimers();
    const { client } = connected();
    const result = expect(client.mcpSettings("save")).rejects.toThrow(
      "timed out",
    );
    await vi.advanceTimersByTimeAsync(30001);
    await result;
  });
});
