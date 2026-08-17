interface GatewayStatus {
  ready: boolean;
}

interface WaitForGatewayReadyOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

export async function waitForGatewayReady(
  readStatus: () => Promise<GatewayStatus>,
  options: WaitForGatewayReadyOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((delayMs: number) => (
    new Promise<void>((resolve) => window.setTimeout(resolve, delayMs))
  ));
  const deadline = now() + timeoutMs;

  while (true) {
    try {
      if ((await readStatus()).ready) return true;
    } catch {
      // The bridge may be between startup attempts; keep polling briefly.
    }
    if (now() >= deadline) return false;
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
  }
}
