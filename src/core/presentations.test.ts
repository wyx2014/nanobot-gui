import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', () => ({ fetchGatewayResponse: mocks.request }));
vi.mock('./nanobotClient', () => ({
  getNanobotStatus: async () => ({ port: 8900 }),
  getNanobotToken: () => 'gateway-token',
  refreshNanobotAuth: vi.fn(),
}));

const response = (payload: unknown) => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });

beforeEach(() => { vi.resetModules(); mocks.request.mockReset(); });

describe('presentation catalog cache', () => {
  it('shares an in-flight catalog request and exposes the last result for immediate reopening', async () => {
    const api = await import('./presentations');
    const catalog = { templates: [{ id: 'kimi-work' }] };
    let resolve!: (response: Response) => void;
    mocks.request.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    const first = api.fetchPresentationTemplates();
    const second = api.fetchPresentationTemplates();
    await Promise.resolve();
    expect(first).toBe(second);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(api.getCachedPresentationTemplates()).toBeUndefined();
    resolve(response(catalog));
    await first;
    expect(api.getCachedPresentationTemplates()).toEqual(catalog);
    expect(mocks.request.mock.calls[0][0]).toBe('http://127.0.0.1:8900/api/presentations/templates');
  });

  it('keeps cached data on request failure and allows retry', async () => {
    const api = await import('./presentations');
    const catalog = { templates: [{ id: 'taiping-standard' }] };
    mocks.request.mockResolvedValueOnce(response(catalog));
    await api.fetchPresentationTemplates();
    mocks.request.mockRejectedValueOnce(new Error('Gateway restarting'));
    await expect(api.fetchPresentationTemplates()).rejects.toThrow('Gateway restarting');
    expect(api.getCachedPresentationTemplates()).toEqual(catalog);
    mocks.request.mockResolvedValueOnce(response(catalog));
    await expect(api.fetchPresentationTemplates()).resolves.toEqual(catalog);
  });
});
