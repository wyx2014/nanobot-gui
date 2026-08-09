import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchThreadResource,
  fetchWebuiThread,
  registerTokenProvider,
  THREAD_HISTORY_MESSAGE_LIMIT,
} from "./api";

afterEach(() => {
  registerTokenProvider(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("canonical thread history limits", () => {
  it("requests the maximum bounded history page by default", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockResolvedValueOnce(jsonResponse({ messages: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchThreadResource(
      "token",
      "websocket:chat-a",
      "http://127.0.0.1:8900",
    );
    await fetchWebuiThread(
      "token",
      "websocket:chat-a",
      "http://127.0.0.1:8900",
    );

    const threadUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    const fallbackUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(threadUrl.searchParams.get("message_limit")).toBe(
      String(THREAD_HISTORY_MESSAGE_LIMIT),
    );
    expect(fallbackUrl.searchParams.get("limit")).toBe(
      String(THREAD_HISTORY_MESSAGE_LIMIT),
    );
  });

  it("preserves an explicit smaller page size for backwards pagination", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ messages: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchThreadResource(
      "token",
      "websocket:chat-a",
      "http://127.0.0.1:8900",
      { messageLimit: 37, beforeMessageEventSeq: 100 },
    );

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("message_limit")).toBe("37");
    expect(url.searchParams.get("before_message_event_seq")).toBe("100");
  });
});
