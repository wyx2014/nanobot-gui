import { afterEach, describe, expect, it, vi } from "vitest";

import {
  archiveSession,
  createModelConfiguration,
  deleteModelConfiguration,
  deleteProviderSettings,
  deleteScheduleRun,
  fetchThreadResource,
  fetchArchivedData,
  fetchProviderModels,
  fetchWebuiThread,
  purgeSession,
  registerTokenProvider,
  THREAD_HISTORY_MESSAGE_LIMIT,
} from "./api";

afterEach(() => {
  registerTokenProvider(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
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

describe("provider settings", () => {
  it("persists provider-declared model capabilities when creating a preset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ model_presets: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createModelConfiguration(
      "gateway-token",
      {
        label: "Step chat",
        provider: "stepfun",
        model: "opaque-model-id",
        capabilities: ["text"],
        capabilitySource: "provider",
      },
      "http://127.0.0.1:8900",
    );

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("capabilities")).toBe("text");
    expect(url.searchParams.get("capability_source")).toBe("provider");
  });

  it("uses the saved provider credential when a model probe omits apiKey", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      status: "available",
      models: [{ id: "deepseek-chat" }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchProviderModels(
      "gateway-token",
      {
        provider: "asset-deepseek",
        apiBase: "http://model.test/v1",
        apiType: "auto",
      },
      "http://127.0.0.1:8900",
    );

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("provider")).toBe("asset-deepseek");
    expect(url.searchParams.has("api_key")).toBe(false);
  });

  it("deletes a custom provider through the gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ providers: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteProviderSettings(
      "gateway-token",
      "my-company-api",
      "http://127.0.0.1:8900",
    );

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/settings/provider/delete");
    expect(url.searchParams.get("provider")).toBe("my-company-api");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer gateway-token" },
    });
  });

  it("blocks deletion of the desktop-managed provider but allows catalog model replacement", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ providers: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteProviderSettings(
      "gateway-token",
      "asset-deepseek",
      "http://127.0.0.1:8900",
    )).rejects.toThrow("系统内置模型服务不能删除");
    await expect(deleteModelConfiguration(
      "gateway-token",
      "asset-deepseek-r1",
      "http://127.0.0.1:8900",
    )).resolves.toEqual({ providers: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("archived data management", () => {
  it("archives through the semantic archive endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ archived: true }));
    vi.stubGlobal("fetch", fetchMock);

    await archiveSession(
      "gateway-token",
      "websocket:chat-a",
      "http://127.0.0.1:8900",
    );

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/sessions/websocket%3Achat-a/archive");
  });

  it("rejects archive when the session still owns automations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      archived: false,
      blocked_by_automations: true,
      automations: [{ id: "reminder-1", name: "A股开市提醒" }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(archiveSession(
      "gateway-token",
      "websocket:chat-a",
      "http://127.0.0.1:8900",
    )).rejects.toThrow("该会话仍关联自动化任务：A股开市提醒");
  });

  it("rejects an archive response that does not confirm success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ archived: false })));

    await expect(archiveSession(
      "gateway-token",
      "websocket:chat-a",
      "http://127.0.0.1:8900",
    )).rejects.toThrow("本地服务未确认会话归档");
  });

  it("formats automation blockers when permanent deletion is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      purged: false,
      blocked_by_automations: true,
      automations: [{ id: "daily-1", name: "每日 AI 新闻推送" }],
    }, 409)));

    await expect(purgeSession(
      "gateway-token",
      "websocket:chat-a",
      "http://127.0.0.1:8900",
    )).rejects.toThrow("正在使用的自动化任务：每日 AI 新闻推送");
  });

  it("maps archived sessions and workspaces into renderer payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      schema_version: 1,
      archived_sessions: [{
        session_key: "websocket:chat-a",
        session_id: "ses-a",
        project_id: "prj-a",
        title: "Archived task",
        preview: "preview",
        project_name: "Research",
        project_root: "/work/research",
        created_at: "2026-08-12T00:00:00",
        updated_at: "2026-08-13T00:00:00",
        archived_at: 123,
      }],
      archived_projects: [{
        id: "prj-b",
        kind: "workspace",
        name: "Old project",
        root_path: "/work/old",
        status: "archived",
        created_at: 10,
        updated_at: 20,
        archived_at: 30,
        session_count: 4,
        files_deleted: false,
      }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await fetchArchivedData(
      "gateway-token",
      "http://127.0.0.1:8900",
    );

    expect(data.archivedSessions[0]).toMatchObject({
      sessionKey: "websocket:chat-a",
      projectName: "Research",
      archivedAt: 123,
    });
    expect(data.archivedProjects[0]).toMatchObject({
      id: "prj-b",
      sessionCount: 4,
      filesDeleted: false,
    });
  });
});

describe("schedule run history", () => {
  it("deletes one run through the gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ tasks: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteScheduleRun(
      "gateway-token",
      "daily-brief",
      "run-1",
      "http://127.0.0.1:8900",
    );

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/schedule/runs/delete");
    expect(url.searchParams.get("task_id")).toBe("daily-brief");
    expect(url.searchParams.get("run_id")).toBe("run-1");
  });
});
