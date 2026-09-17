import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExpertMetadata } from '@/types';
import type { NanobotSkillInfo, SkillsPayload } from '@/core/types';
import type { DiagnosticEvent } from '@/shared/diagnostics';
import { sanitizeDiagnostic } from '@/shared/diagnostics';
import { flushDiagnostics } from '@/core/diagnostics';
import { useDiscoveryStore } from './discoveryStore';

const mocks = vi.hoisted(() => ({
  fetchSkills: vi.fn(), getNanobotStatus: vi.fn(), discoverExperts: vi.fn(),
}));
vi.mock('@/core/api', () => ({ fetchSkills: mocks.fetchSkills }));
vi.mock('@/core/nanobotClient', () => ({
  getNanobotStatus: mocks.getNanobotStatus,
  getNanobotToken: () => 'private-token', refreshNanobotAuth: vi.fn(),
}));
vi.mock('@/core/expert/registry', () => ({
  expertRegistry: { discoverExperts: mocks.discoverExperts },
}));

const skill: NanobotSkillInfo = {
  name: 'private-skill', description: 'private-description',
  path: 'C:\\Users\\private-user\\workspace\\skills\\private-skill\\SKILL.md',
  source: 'workspace', enabled: true, available: true, missing: '',
  user_invocable: true, always: false, tags: [], content: 'private-content',
};
const payload: SkillsPayload = { skills: [skill], disabled: [], installed_count: 1 };

function events(): DiagnosticEvent[] {
  flushDiagnostics();
  return vi.mocked(window.ipc.send).mock.calls.flatMap((call) =>
    (call[1] as { events: DiagnosticEvent[] }).events);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  flushDiagnostics();
  vi.mocked(window.ipc.send).mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.getNanobotStatus.mockReset().mockResolvedValue({ ready: true, port: 8900 });
  mocks.fetchSkills.mockReset().mockResolvedValue(payload);
  mocks.discoverExperts.mockReset().mockResolvedValue([]);
  useDiscoveryStore.setState({ skills: [], experts: [], agents: [], isLoading: false });
});
afterEach(() => { flushDiagnostics(); vi.restoreAllMocks(); });

it('records received and filtered counts under one refresh ID without recording skill contents', async () => {
  mocks.fetchSkills.mockResolvedValue({ ...payload, skills: [
    skill, { ...skill, enabled: false }, { ...skill, available: false },
    { ...skill, user_invocable: false },
  ] });
  await useDiscoveryStore.getState().refresh();
  const log = events();
  const received = log.find((event) => event.event_name === 'renderer.skills.fetch' && event.status === 'completed')!;
  expect(received.details).toMatchObject({
    count: 4, workspace_count: 4, eligible_count: 1, disabled_count: 1,
    unavailable_count: 1, non_invocable_count: 1, invalid_tags_count: 0,
  });
  // Main-process ingestion sanitizes the same event a second time.
  expect(sanitizeDiagnostic(received)?.details).toEqual(received.details);
  expect(new Set(log.map((event) => event.client_action_id)).size).toBe(1);
  expect(log.at(-1)).toMatchObject({ event_name: 'renderer.skills.refresh', status: 'completed',
    details: { stage: 'published', count: 1 } });
  expect(JSON.stringify(log)).not.toContain('private-');
  expect(useDiscoveryStore.getState().skills).toHaveLength(1);
});

it('identifies expert-scan failure separately from a successful skills response', async () => {
  mocks.discoverExperts.mockRejectedValue(Object.assign(new Error('private-directory'), { code: 'EACCES' }));
  await useDiscoveryStore.getState().refresh();
  const log = events();
  expect(log).toEqual(expect.arrayContaining([
    expect.objectContaining({ event_name: 'renderer.skills.fetch', status: 'completed' }),
    expect.objectContaining({ event_name: 'renderer.skills.legacy_experts', status: 'failed',
      details: expect.objectContaining({ error_code: 'EACCES', error_category: 'storage.permission' }) }),
    expect.objectContaining({ event_name: 'renderer.skills.refresh', status: 'failed',
      details: expect.objectContaining({ stage: 'parallel_load', count: 0 }) }),
  ]));
  expect(JSON.stringify(log)).not.toContain('private-');
  // Diagnostics must preserve the existing failure behavior, not implement a fix.
  expect(useDiscoveryStore.getState().skills).toEqual([]);
});

it('leaves a start event for a pending expert scan without inferring failure', async () => {
  const experts = deferred<ExpertMetadata[]>();
  mocks.discoverExperts.mockReturnValue(experts.promise);
  const refreshing = useDiscoveryStore.getState().refresh();
  await vi.waitFor(() => expect(events()).toEqual(expect.arrayContaining([
    expect.objectContaining({ event_name: 'renderer.skills.fetch', status: 'completed' }),
  ])));
  const log = events();
  expect(log.filter((event) => event.event_name === 'renderer.skills.legacy_experts').map((event) => event.status)).toEqual(['started']);
  expect(log.some((event) => event.status === 'failed')).toBe(false);
  expect(useDiscoveryStore.getState().isLoading).toBe(true);
  experts.resolve([]);
  await refreshing;
});

it('records malformed tags before the existing mapping step fails', async () => {
  const withoutTags = { ...skill };
  Reflect.deleteProperty(withoutTags, 'tags');
  mocks.fetchSkills.mockResolvedValue({ ...payload, skills: [withoutTags] });
  await useDiscoveryStore.getState().refresh();
  const log = events();
  expect(log).toEqual(expect.arrayContaining([
    expect.objectContaining({ event_name: 'renderer.skills.fetch', status: 'completed',
      details: expect.objectContaining({ eligible_count: 1, invalid_tags_count: 1 }) }),
    expect.objectContaining({ event_name: 'renderer.skills.refresh', status: 'failed',
      details: expect.objectContaining({ stage: 'map', error_type: 'TypeError' }) }),
  ]));
  expect(useDiscoveryStore.getState().skills).toEqual([]);
});

it('records a skipped fetch when the gateway is not ready', async () => {
  mocks.getNanobotStatus.mockResolvedValue({ ready: false, port: 8900 });
  await useDiscoveryStore.getState().refresh();
  expect(events()).toEqual(expect.arrayContaining([
    expect.objectContaining({ event_name: 'renderer.skills.fetch_gate',
      details: expect.objectContaining({ ready: false, stage: 'skip_fetch' }) }),
  ]));
  expect(mocks.fetchSkills).not.toHaveBeenCalled();
});

it('distinguishes a skill request error from an expert scan error', async () => {
  mocks.fetchSkills.mockRejectedValue(Object.assign(new Error('private-response'), { status: 401 }));
  await useDiscoveryStore.getState().refresh();
  expect(events()).toEqual(expect.arrayContaining([
    expect.objectContaining({ event_name: 'renderer.skills.fetch', status: 'failed',
      details: expect.objectContaining({ status_code: 401, error_category: 'auth.rejected' }) }),
    expect.objectContaining({ event_name: 'renderer.skills.legacy_experts', status: 'completed' }),
  ]));
});

it('keeps overlapping refreshes distinguishable when an older empty response publishes last', async () => {
  const older = deferred<SkillsPayload>();
  mocks.fetchSkills.mockReturnValueOnce(older.promise);
  const first = useDiscoveryStore.getState().refresh();
  await vi.waitFor(() => expect(mocks.fetchSkills).toHaveBeenCalledOnce());
  await useDiscoveryStore.getState().refresh();
  older.resolve({ ...payload, skills: [] });
  await first;
  const refreshes = events().filter((event) => event.event_name === 'renderer.skills.refresh');
  const started = refreshes.filter((event) => event.status === 'started');
  const completed = refreshes.filter((event) => event.status === 'completed');
  expect(started[0].client_action_id).not.toBe(started[1].client_action_id);
  expect(completed.map((event) => [event.client_action_id, event.details?.count])).toEqual([
    [started[1].client_action_id, 1], [started[0].client_action_id, 0],
  ]);
});
