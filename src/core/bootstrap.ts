import type { BootstrapResponse } from "./types";

export const DEFAULT_HTTP_TIMEOUT_MS = 20_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<Response> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetch(input, init);
  }

  const controller = typeof AbortController !== "undefined"
    ? new AbortController()
    : null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const request = fetch(input, {
    ...init,
    signal: controller?.signal ?? init.signal,
  });
  const timeout = new Promise<Response>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
      controller?.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * Fetch a short-lived token + the WebSocket path from the gateway's
 * ``/webui/bootstrap`` endpoint.
 */
export async function fetchBootstrap(
  baseUrl: string = "",
  secret: string = "",
  timeoutMs?: number,
): Promise<BootstrapResponse> {
  const headers: Record<string, string> = {};
  if (secret) {
    headers["X-Nanobot-Auth"] = secret;
  }
  const res = await fetchWithTimeout(`${baseUrl}/webui/bootstrap`, {
    method: "GET",
    credentials: "same-origin",
    headers,
  }, timeoutMs);
  if (!res.ok) {
    throw new Error(`bootstrap failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as BootstrapResponse;
  if (!body.token || !body.ws_path) {
    throw new Error("bootstrap response missing token or ws_path");
  }
  return body;
}

/** Derive a WebSocket URL from the current window location and the server-provided path. */
export function deriveWsUrl(
  wsPath: string,
  token: string,
  wsUrl?: string | null,
): string {
  const query = `?token=${encodeURIComponent(token)}`;
  if (wsUrl && /^(wss?|nanobot-host):\/\//i.test(wsUrl)) {
    const join = wsUrl.includes("?") ? "&" : "?";
    return `${wsUrl}${join}token=${encodeURIComponent(token)}`;
  }
  const path = wsPath && wsPath.startsWith("/") ? wsPath : `/${wsPath || ""}`;
  if (typeof window === "undefined") {
    return `ws://127.0.0.1:8900${path}${query}`;
  }
  if (window.location.port === "5173") {
    const host = window.location.hostname.includes(":")
      ? `[${window.location.hostname}]`
      : window.location.hostname;
    return `ws://${host}:8900${path}${query}`;
  }
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.host;
  return `${scheme}://${host}${path}${query}`;
}
