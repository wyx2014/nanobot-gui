import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initLanguage } from "@/i18n";
import { requestMcpEditor } from "@/core/api";
import type { McpPresetInfo } from "@/core/types";
import MCPSection from "./MCPSection";
import { McpServerDialog } from "./McpServerDialog";

vi.mock("@/core/api", () => ({ requestMcpEditor: vi.fn() }));
const api = vi.mocked(requestMcpEditor);
const server: McpPresetInfo = {
  name: "docs",
  display_name: "Company docs",
  category: "",
  description: "",
  docs_url: "",
  transport: "streamableHttp",
  requires: "",
  note: "",
  install_supported: true,
  installed: true,
  configured: true,
  available: true,
  status: "configured",
  required_fields: [],
  connection_summary: "https://example.com/mcp",
  enabled: true,
  connection_state: "failed",
  source: "custom",
  connection: {
    transport: "streamableHttp",
    url: "https://example.com/mcp",
    command: "",
    args: [],
    cwd: "",
    tool_timeout: 30,
    has_env: false,
    has_headers: false,
  },
};
let root: Root;
let container: HTMLDivElement;
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  initLanguage("en-US");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.mockReset();
  api.mockResolvedValue({
    presets: [
      server,
      { ...server, name: "off", display_name: "Disabled docs", enabled: false },
    ],
    installed_count: 2,
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const button = (text: string) =>
  [...document.querySelectorAll("button")].find(
    (node) => node.textContent === text,
  )!;

it("keeps failed and disabled services in My servers and closes a controlled Add dialog", async () => {
  const close = vi.fn();
  await act(async () =>
    root.render(<MCPSection showAddForm onAddFormChange={close} />),
  );
  expect(container.textContent).toContain("Connection failed");
  expect(container.textContent).toContain("Disabled docs");
  expect(container.querySelector(".mcp-state-dot.connected")).toBeNull();
  await act(async () => button("Cancel").click());
  expect(close).toHaveBeenCalledWith(false);
});

it("retains the draft after a failed saved connection and lets the next save edit that server", async () => {
  const close = vi.fn();
  api.mockResolvedValue({
    presets: [server],
    installed_count: 1,
    last_action: {
      ok: false,
      saved: true,
      names: ["docs"],
      message: "Connection failed",
    },
  });
  await act(async () =>
    root.render(
      <McpServerDialog
        server={server}
        isEnglish
        onClose={close}
        onResult={vi.fn()}
      />,
    ),
  );
  await act(async () => button("Save and connect").click());
  expect(close).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Configuration saved",
  );
  expect(document.querySelector<HTMLInputElement>("input")?.value).toBe(
    "Company docs",
  );
  await act(async () => button("Save and connect").click());
  expect(api.mock.lastCall?.[1]).toMatchObject({
    original_name: "docs",
    tool_timeout: 30,
  });
});

it("allows closing and aborting an in-progress probe", async () => {
  const close = vi.fn();
  api.mockImplementation(
    (_action, _values, signal) =>
      new Promise((_resolve, reject) =>
        signal?.addEventListener("abort", () =>
          reject(new DOMException("Cancelled", "AbortError")),
        ),
      ),
  );
  await act(async () =>
    root.render(
      <McpServerDialog
        server={server}
        isEnglish
        onClose={close}
        onResult={vi.fn()}
      />,
    ),
  );
  await act(async () => button("Test connection").click());
  expect(button("Cancel").disabled).toBe(false);
  await act(async () => button("Cancel").click());
  expect(api.mock.lastCall?.[2]?.aborted).toBe(true);
  expect(close).toHaveBeenCalledOnce();
});
