import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PersonalizationSection } from "./SettingsView";

vi.mock("@/utils/version", () => ({ APP_VERSION: "0.5.9" }));

const mocks = vi.hoisted(() => ({
  fetchPersonalization: vi.fn(),
  savePersonalization: vi.fn(),
  restorePersonalization: vi.fn(),
  getNanobotStatus: vi.fn(),
  getNanobotToken: vi.fn(),
  refreshNanobotAuth: vi.fn(),
}));

vi.mock("@/core/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/core/api")>(),
  fetchPersonalization: mocks.fetchPersonalization,
  savePersonalization: mocks.savePersonalization,
  restorePersonalization: mocks.restorePersonalization,
}));

vi.mock("@/core/nanobotClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/core/nanobotClient")>(),
  getNanobotStatus: mocks.getNanobotStatus,
  getNanobotToken: mocks.getNanobotToken,
  refreshNanobotAuth: mocks.refreshNanobotAuth,
}));

let container: HTMLDivElement;
let root: Root;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function inputTextarea(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(async () => {
  mocks.getNanobotStatus.mockResolvedValue({ ready: true, port: 8900 });
  mocks.getNanobotToken.mockReturnValue("test-token");
  mocks.fetchPersonalization.mockResolvedValue({ soul: "# Soul", user: "# User" });
  mocks.savePersonalization.mockImplementation(async (_token, values) => ({
    soul: values.soul ?? "# Soul",
    user: values.user ?? "# User",
  }));
  mocks.restorePersonalization.mockResolvedValue({ soul: "# Default Soul", user: "# User" });

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<PersonalizationSection isEnglish={false} />));
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("PersonalizationSection", () => {
  it("edits persona and profile on separate tabs and saves both drafts together", async () => {
    const soulTab = container.querySelector<HTMLButtonElement>('[data-personalization-tab="soul"]');
    const userTab = container.querySelector<HTMLButtonElement>('[data-personalization-tab="user"]');
    const saveButton = container.querySelector<HTMLButtonElement>("[data-personalization-save]");

    expect(soulTab?.getAttribute("data-active")).toBe("true");
    expect(userTab?.getAttribute("data-active")).toBe("false");
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("# Soul");
    expect(saveButton?.disabled).toBe(true);

    act(() => {
      const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
      if (textarea) inputTextarea(textarea, "# Changed Soul");
    });
    expect(soulTab?.getAttribute("data-dirty")).toBe("true");

    act(() => userTab?.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("# User");
    act(() => {
      const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
      if (textarea) inputTextarea(textarea, "# Changed User");
    });

    expect(container.textContent).toContain("2 个切页有未保存更改");
    expect(saveButton?.disabled).toBe(false);

    await act(async () => saveButton?.click());
    await settle();

    expect(mocks.savePersonalization).toHaveBeenCalledWith(
      "test-token",
      { soul: "# Changed Soul", user: "# Changed User" },
      "http://127.0.0.1:8900",
    );
    expect(container.textContent).toContain("所有更改均已保存");
    expect(saveButton?.disabled).toBe(true);
  });

  it("restores only the active file without discarding a draft on the other tab", async () => {
    const soulTab = container.querySelector<HTMLButtonElement>('[data-personalization-tab="soul"]');
    const userTab = container.querySelector<HTMLButtonElement>('[data-personalization-tab="user"]');
    Object.defineProperty(window, "confirm", {
      configurable: true,
      value: vi.fn(() => true),
    });

    act(() => userTab?.click());
    act(() => {
      const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
      if (textarea) inputTextarea(textarea, "# Unsaved User");
    });

    act(() => soulTab?.click());
    const restoreButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("恢复默认"));
    await act(async () => restoreButton?.click());
    await settle();

    expect(mocks.restorePersonalization).toHaveBeenCalledWith(
      "test-token",
      "soul",
      "http://127.0.0.1:8900",
    );
    act(() => userTab?.click());
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("# Unsaved User");
    expect(userTab?.getAttribute("data-dirty")).toBe("true");
  });
});
