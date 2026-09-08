import { describe, expect, it } from "vitest";
import type { McpPresetInfo } from "@/core/types";
import { createMcpForm, mcpFormValues, newPair } from "./mcpForm";

describe("MCP form serialization", () => {
  it("preserves redacted URLs and blank stored secrets, and explicitly removes deleted keys", () => {
    const server = {
      name: "docs",
      display_name: "Docs",
      enabled: false,
      connection: {
        transport: "streamableHttp",
        url: "https://example.com/mcp?token=***",
        has_headers: true,
        header_keys: ["Authorization", "Old"],
        env_keys: ["TOKEN"],
        tool_timeout: 90,
        connect_timeout: 20,
      },
    } as McpPresetInfo;
    const form = createMcpForm(server);
    form.headers = form.headers.filter((row) => row.key !== "Old");
    const values = mcpFormValues(form, server);
    expect(values).not.toHaveProperty("url");
    expect(values).toMatchObject({
      original_name: "docs",
      enabled: false,
      headers_patch: { Old: null },
      env_patch: {},
      connect_timeout: 20,
      tool_timeout: 90,
    });
  });

  it("keeps argument boundaries, accepts Chinese names and uses seconds", () => {
    const form = createMcpForm();
    Object.assign(form, {
      displayName: "本地知识库",
      transport: "stdio",
      command: "npx",
      args: ["-y", "package", "/path with spaces"],
      env: [
        { ...newPair("TOKEN"), value: "a" },
        { ...newPair("token"), value: "b" },
      ],
    });
    expect(mcpFormValues(form)).toMatchObject({
      display_name: "本地知识库",
      args: ["-y", "package", "/path with spaces"],
      connect_timeout: 15,
      tool_timeout: 30,
      env_patch: { TOKEN: "a", token: "b" },
    });
    form.toolTimeout = "30000";
    expect(() => mcpFormValues(form)).toThrow("1-600");
  });

  it("validates header duplicates and replaces old authentication when switching to Bearer", () => {
    const form = createMcpForm();
    Object.assign(form, {
      displayName: "Docs",
      url: "https://example.com/mcp",
      auth: "headers",
      headers: [
        { ...newPair("Token"), value: "a" },
        { ...newPair("token"), value: "b" },
      ],
    });
    expect(() => mcpFormValues(form)).toThrow("Duplicate");
    form.auth = "bearer";
    form.token = "Bearer secret";
    expect(mcpFormValues(form).headers_patch).toEqual({
      Authorization: "Bearer secret",
    });
  });
});
