import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearProjectMemories,
  consolidateProjectMemories,
  forgetProjectMemory,
  listProjectMemories,
  registerTokenProvider,
  reindexProjectMemories,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  registerTokenProvider(null);
});

describe("project memory gateway API", () => {
  it("maps scoped memory, provenance, job status, and retrieval mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      project_id: "prj_a",
      memories: [{
        id: "mem_a",
        project_id: "prj_a",
        kind: "workflow",
        title: "Package manager",
        content: "Use pnpm.",
        status: "active",
        usage_count: 3,
        last_used_at: 100,
        created_at: 10,
        updated_at: 20,
        sources: [{
          id: "src_a",
          stage1_id: "m1_a",
          source_session_id: "ses_a",
          source_session_key: "websocket:chat-a",
          created_at: 11,
        }],
      }],
      status: {
        project_id: "prj_a",
        input_watermark: 42,
        phase1: null,
        phase2: {
          status: "succeeded",
          attempt_count: 1,
          updated_at: 20,
          completed_at: 21,
        },
      },
      retrieval: {
        mode: "bounded_lexical",
        deep_rag_enabled: false,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    const payload = await listProjectMemories("token", "prj_a", "http://gateway");

    expect(payload.projectId).toBe("prj_a");
    expect(payload.memories[0].usageCount).toBe(3);
    expect(payload.memories[0].sources[0].sourceSessionKey).toBe("websocket:chat-a");
    expect(payload.status.phase2?.status).toBe("succeeded");
    expect(payload.retrieval.deepRagEnabled).toBe(false);
  });

  it("uses explicit GET action aliases supported by the websocket HTTP adapter", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        refreshed: true,
        status: { project_id: "prj_a", input_watermark: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        artifacts_seen: 2,
        indexed: 1,
        skipped: 1,
        missing: 0,
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ removed: 4 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await consolidateProjectMemories("token", "prj_a", "http://gateway");
    await reindexProjectMemories("token", "prj_a", "http://gateway");
    await forgetProjectMemory("token", "prj_a", "mem_a", "http://gateway");
    await clearProjectMemories("token", "prj_a", "http://gateway");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://gateway/api/projects/prj_a/memories/consolidate",
      "http://gateway/api/projects/prj_a/memories/reindex",
      "http://gateway/api/projects/prj_a/memories/mem_a/forget",
      "http://gateway/api/projects/prj_a/memories/clear",
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => init.method === undefined)).toBe(true);
  });
});
