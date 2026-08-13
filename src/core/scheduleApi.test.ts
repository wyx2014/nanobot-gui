import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScheduleTask } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('schedule API', () => {
  it('sends the monthly frequency and day of month to the gateway', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tasks: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await createScheduleTask('token', {
      name: '月度工作复盘',
      prompt: '复盘上一个自然月的工作。',
      schedule: {
        frequency: 'monthly',
        time: { hour: 9, minute: 15 },
        dayOfMonth: 1,
      },
    }, 'http://127.0.0.1:8900');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/schedule/tasks/create');
    expect(url.searchParams.get('frequency')).toBe('monthly');
    expect(url.searchParams.get('hour')).toBe('9');
    expect(url.searchParams.get('minute')).toBe('15');
    expect(url.searchParams.get('day_of_month')).toBe('1');
  });
});
