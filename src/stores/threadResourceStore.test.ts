import { beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalSessionEvent, ThreadResource } from '@/core/types';
import { useThreadResourceStore } from './threadResourceStore';

function resource(overrides: Partial<ThreadResource> = {}): ThreadResource {
  return {
    schema_version: 3,
    project_id: 'prj-a',
    session_id: 'ses-a',
    session_key: 'websocket:chat-a',
    last_event_seq: 4,
    snapshot_revision: 4_000_000,
    runtime_snapshot_revision: 2,
    runtime_epoch: 'epoch-a',
    thread_status: { type: 'idle' },
    active_turn: null,
    latest_turn: null,
    messages: [],
    plan: null,
    artifact_revision: 0,
    artifacts: [],
    from_event_seq: 0,
    to_event_seq: 0,
    events: [],
    has_more: false,
    resync_required: false,
    ...overrides,
  };
}

function event(overrides: Partial<CanonicalSessionEvent> = {}): CanonicalSessionEvent {
  return {
    schema_version: 3,
    event_id: 'evt-5',
    event_seq: 5,
    event: 'turn_started',
    recorded_at: 1_000,
    project_id: 'prj-a',
    session_id: 'ses-a',
    session_key: 'websocket:chat-a',
    turn_id: 'turn-a',
    turn: {
      id: 'turn-a',
      trace_id: 'trc-a',
      runtime_epoch: 'epoch-a',
      project_id: 'prj-a',
      session_id: 'ses-a',
      status: 'inProgress',
      started_at: 1_000,
    },
    ...overrides,
  };
}

describe('threadResourceStore', () => {
  beforeEach(() => {
    useThreadResourceStore.setState({
      resourcesBySession: {},
      resyncRequiredBySession: {},
    });
  });

  it('replaces one session snapshot and ignores an older same-epoch snapshot', () => {
    const store = useThreadResourceStore.getState();
    expect(store.replaceSnapshot(resource())).toBe(true);
    expect(store.replaceSnapshot(resource({ snapshot_revision: 3_000_000 }))).toBe(false);
    expect(
      useThreadResourceStore.getState().resourcesBySession['websocket:chat-a']
        .snapshot_revision,
    ).toBe(4_000_000);
  });

  it('applies a consecutive event and rejects duplicates', () => {
    const store = useThreadResourceStore.getState();
    store.replaceSnapshot(resource());

    expect(store.applyCanonicalEvent(event())).toBe('applied');
    expect(store.applyCanonicalEvent(event())).toBe('duplicate');
    const current = useThreadResourceStore.getState()
      .resourcesBySession['websocket:chat-a'];
    expect(current.last_event_seq).toBe(5);
    expect(current.thread_status.type).toBe('active');
    expect(current.active_turn?.trace_id).toBe('trc-a');
  });

  it('clears the previous turn plan when a new canonical turn starts', () => {
    const store = useThreadResourceStore.getState();
    store.replaceSnapshot(resource({
      plan: {
        id: 'old-plan',
        turn_id: 'old-turn',
        kind: 'dynamic',
        owner: 'agent',
        policy: 'optional',
        execution: 'serial',
        status: 'completed',
        revision: 4,
        active_step_ids: [],
        steps: [],
      },
    }));

    expect(store.applyCanonicalEvent(event())).toBe('applied');
    expect(
      useThreadResourceStore.getState().resourcesBySession['websocket:chat-a'].plan,
    ).toBeNull();
  });

  it('fails closed on a sequence gap and requests snapshot recovery', () => {
    const store = useThreadResourceStore.getState();
    store.replaceSnapshot(resource());

    expect(store.applyCanonicalEvent(event({ event_seq: 7, event_id: 'evt-7' }))).toBe('gap');
    expect(
      useThreadResourceStore.getState().resyncRequiredBySession['websocket:chat-a'],
    ).toBe(true);
    expect(
      useThreadResourceStore.getState().resourcesBySession['websocket:chat-a']
        .last_event_seq,
    ).toBe(4);
  });

  it('projects canonical task progress events into the session plan', () => {
    const store = useThreadResourceStore.getState();
    store.replaceSnapshot(resource());

    expect(store.applyCanonicalEvent(event({
      event: 'message',
      agent_ui: {
        kind: 'task_progress',
        plan_id: 'plan-a',
        turn_id: 'turn-a',
        plan_kind: 'workflow',
        owner: 'expert_team:research',
        policy: 'required',
        execution: 'staged',
        status: 'inProgress',
        revision: 3,
        active_step_ids: ['step-2'],
        current_step_id: 'step-2',
        steps: [
          { id: 'step-1', title: '基础数据包', status: 'completed' },
          { id: 'step-2', title: '并行研究', status: 'inProgress' },
        ],
      },
    }))).toBe('applied');

    const plan = useThreadResourceStore.getState()
      .resourcesBySession['websocket:chat-a'].plan;
    expect(plan?.id).toBe('plan-a');
    expect(plan?.revision).toBe(3);
    expect(plan?.active_step_ids).toEqual(['step-2']);
  });

  it('never lets another project or session mutate the resource', () => {
    const store = useThreadResourceStore.getState();
    store.replaceSnapshot(resource());

    expect(store.applyCanonicalEvent(event({ project_id: 'prj-b' })))
      .toBe('identity_mismatch');
    expect(store.applyCanonicalEvent(event({ session_id: 'ses-b' })))
      .toBe('identity_mismatch');
    expect(
      useThreadResourceStore.getState().resourcesBySession['websocket:chat-a']
        .last_event_seq,
    ).toBe(4);
  });

  it('accepts runtime updates only for the same stable identity', () => {
    const store = useThreadResourceStore.getState();
    store.replaceSnapshot(resource());

    expect(store.applyRuntimeSnapshot('chat-a', {
      session_key: 'websocket:chat-a',
      project_id: 'prj-a',
      session_id: 'ses-a',
      runtime_epoch: 'epoch-a',
      snapshot_revision: 3,
      thread_status: { type: 'active', active_flags: [] },
      active_turn: null,
      latest_turn: null,
    })).toBe(true);
    expect(store.applyRuntimeSnapshot('chat-a', {
      session_key: 'websocket:chat-a',
      project_id: 'prj-b',
      session_id: 'ses-a',
      runtime_epoch: 'epoch-a',
      snapshot_revision: 4,
      thread_status: { type: 'idle' },
      active_turn: null,
      latest_turn: null,
    })).toBe(false);
  });

  it('mirrors revisioned plan resources without allowing identity leaks or rollback', () => {
    const store = useThreadResourceStore.getState();
    store.replaceSnapshot(resource());
    const plan = {
      id: 'plan-a',
      project_id: 'prj-a',
      session_id: 'ses-a',
      turn_id: 'turn-a',
      kind: 'dynamic' as const,
      owner: 'agent',
      policy: 'optional' as const,
      execution: 'serial' as const,
      status: 'inProgress' as const,
      revision: 2,
      active_step_ids: ['step-a'],
      steps: [{ id: 'step-a', title: '分析', status: 'inProgress' as const }],
    };

    expect(store.applyPlanResource('chat-a', plan)).toBe(true);
    expect(store.applyPlanResource('chat-a', { ...plan, revision: 1 })).toBe(false);
    expect(store.applyPlanResource('chat-a', {
      ...plan,
      project_id: 'prj-b',
      revision: 3,
    })).toBe(false);
    expect(
      useThreadResourceStore.getState().resourcesBySession['websocket:chat-a']
        .plan?.revision,
    ).toBe(2);
  });
});
