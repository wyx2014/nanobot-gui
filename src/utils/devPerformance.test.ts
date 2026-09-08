import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDevLowPowerMode } from './devPerformance';

afterEach(() => vi.unstubAllEnvs());

describe('development low power mode', () => {
  it('defaults to low power in development and permits full effects locally', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_DEV_LOW_POWER', undefined);
    expect(isDevLowPowerMode()).toBe(true);
    vi.stubEnv('VITE_DEV_LOW_POWER', '0');
    expect(isDevLowPowerMode()).toBe(false);
  });

  it('keeps production effects enabled even if a local low power flag is inherited', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DEV_LOW_POWER', '1');
    expect(isDevLowPowerMode()).toBe(false);
  });
});
