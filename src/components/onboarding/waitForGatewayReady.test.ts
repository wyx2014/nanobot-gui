import { describe, expect, it, vi } from 'vitest';
import { waitForGatewayReady } from './waitForGatewayReady';

describe('onboarding gateway prewarm', () => {
  it('waits for the gateway that is warming behind onboarding', async () => {
    let currentTime = 0;
    const readStatus = vi.fn()
      .mockResolvedValueOnce({ ready: false })
      .mockResolvedValueOnce({ ready: false })
      .mockResolvedValueOnce({ ready: true });

    await expect(waitForGatewayReady(readStatus, {
      timeoutMs: 5_000,
      pollIntervalMs: 500,
      now: () => currentTime,
      sleep: async (delayMs) => { currentTime += delayMs; },
    })).resolves.toBe(true);
    expect(readStatus).toHaveBeenCalledTimes(3);
  });

  it('stops waiting after the bounded initialization window', async () => {
    let currentTime = 0;

    await expect(waitForGatewayReady(
      async () => ({ ready: false }),
      {
        timeoutMs: 1_000,
        pollIntervalMs: 400,
        now: () => currentTime,
        sleep: async (delayMs) => { currentTime += delayMs; },
      },
    )).resolves.toBe(false);
    expect(currentTime).toBe(1_000);
  });
});
