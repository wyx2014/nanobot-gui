import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScheduleTask, updateScheduleTask } from './api';

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

  it('sends an exact timestamp and timezone for a one-time reminder', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tasks: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await createScheduleTask('token', {
      name: '提交材料提醒',
      prompt: '提醒我提交材料。',
      schedule: {
        frequency: 'once',
        at: '2099-08-30T01:15:00.000Z',
        timezone: 'Asia/Shanghai',
      },
    }, 'http://127.0.0.1:8900');

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('frequency')).toBe('once');
    expect(url.searchParams.get('at')).toBe('2099-08-30T01:15:00.000Z');
    expect(url.searchParams.get('timezone')).toBe('Asia/Shanghai');
  });

  it('sends connector bindings by name on create and clears them on update', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ tasks: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const data = {
      name: '每日研究',
      prompt: '查询市场数据',
      workspacePath: '/Users/test/research',
      schedule: { frequency: 'daily' as const, time: { hour: 9, minute: 0 } },
    };

    await createScheduleTask('token', {
      ...data, mcpPresets: [{ name: 'juyuan', display_name: '聚源' }],
    }, 'http://127.0.0.1:8900');
    await updateScheduleTask('token', 'daily-study', {
      ...data, mcpPresets: [],
    }, 'http://127.0.0.1:8900');

    const createUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const updateUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(createUrl.searchParams.get('workspace_path')).toBe('/Users/test/research');
    expect(JSON.parse(createUrl.searchParams.get('mcp_presets') ?? '')).toEqual([{ name: 'juyuan' }]);
    expect(updateUrl.searchParams.get('mcp_presets')).toBe('[]');
  });
});
