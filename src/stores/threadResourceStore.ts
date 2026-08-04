import { create } from 'zustand';
import type {
  CanonicalSessionEvent,
  ThreadResource,
  ThreadRuntimeSnapshot,
  TurnLifecycleResource,
  TurnPlanResource,
} from '@/core/types';
import { conversationIdToSessionKey } from '@/core/sessionKey';

export type CanonicalEventApplyResult =
  | 'applied'
  | 'duplicate'
  | 'gap'
  | 'identity_mismatch'
  | 'missing_snapshot';

interface ThreadResourceState {
  resourcesBySession: Record<string, ThreadResource>;
  resyncRequiredBySession: Record<string, boolean>;
  replaceSnapshot: (resource: ThreadResource) => boolean;
  applyRuntimeSnapshot: (
    conversationId: string,
    snapshot: ThreadRuntimeSnapshot,
  ) => boolean;
  applyPlanResource: (
    conversationId: string,
    plan: TurnPlanResource,
  ) => boolean;
  applyCanonicalEvent: (event: CanonicalSessionEvent) => CanonicalEventApplyResult;
  markResyncRequired: (conversationId: string) => void;
  clearSession: (conversationId: string) => void;
}

function sessionKey(value: string): string {
  return conversationIdToSessionKey(value);
}

function validResource(resource: ThreadResource): boolean {
  return Boolean(
    resource
    && resource.project_id
    && resource.session_id
    && resource.session_key
    && Number.isInteger(resource.last_event_seq)
    && resource.last_event_seq >= 0
    && Number.isFinite(resource.snapshot_revision),
  );
}

function eventTurn(event: CanonicalSessionEvent): TurnLifecycleResource | null {
  const candidate = event.turn
    ?? (event.payload && typeof event.payload === 'object' ? event.payload.turn : undefined);
  if (!candidate || typeof candidate !== 'object') return null;
  const turn = candidate as Partial<TurnLifecycleResource>;
  if (typeof turn.id !== 'string' || !turn.id || typeof turn.started_at !== 'number') {
    return null;
  }
  return turn as TurnLifecycleResource;
}

function eventPlan(event: CanonicalSessionEvent): TurnPlanResource | null {
  const payload = event.payload && typeof event.payload === 'object'
    ? event.payload
    : undefined;
  const direct = event.plan ?? payload?.plan;
  const agentUi = event.agent_ui ?? payload?.agent_ui;
  const candidate = direct && typeof direct === 'object'
    ? direct
    : agentUi && typeof agentUi === 'object'
      && (agentUi as Record<string, unknown>).kind === 'task_progress'
      ? {
          id: (agentUi as Record<string, unknown>).plan_id,
          project_id: event.project_id,
          session_id: event.session_id,
          turn_id: (agentUi as Record<string, unknown>).turn_id ?? event.turn_id,
          kind: (agentUi as Record<string, unknown>).plan_kind ?? 'dynamic',
          owner: (agentUi as Record<string, unknown>).owner ?? 'agent',
          policy: (agentUi as Record<string, unknown>).policy ?? 'optional',
          execution: (agentUi as Record<string, unknown>).execution ?? 'serial',
          status: (agentUi as Record<string, unknown>).status ?? 'inProgress',
          revision: (agentUi as Record<string, unknown>).revision,
          active_step_ids: (agentUi as Record<string, unknown>).active_step_ids ?? [],
          current_step_id: (agentUi as Record<string, unknown>).current_step_id,
          note: (agentUi as Record<string, unknown>).note,
          steps: (agentUi as Record<string, unknown>).steps,
          stage_key: (agentUi as Record<string, unknown>).stage_key,
          team_id: (agentUi as Record<string, unknown>).team_id,
          team_run_id: (agentUi as Record<string, unknown>).team_run_id,
        }
      : null;
  if (!candidate) return null;
  const plan = candidate as Partial<TurnPlanResource>;
  if (
    typeof plan.id !== 'string'
    || typeof plan.turn_id !== 'string'
    || typeof plan.revision !== 'number'
    || !Array.isArray(plan.steps)
  ) {
    return null;
  }
  return plan as TurnPlanResource;
}

function withCanonicalEvent(
  resource: ThreadResource,
  event: CanonicalSessionEvent,
): ThreadResource {
  const next: ThreadResource = {
    ...resource,
    last_event_seq: event.event_seq,
    to_event_seq: event.event_seq,
    snapshot_revision: Math.max(
      resource.snapshot_revision,
      event.event_seq * 1_000_000 + Math.min(resource.artifact_revision, 999_999),
    ),
    events: [...resource.events, event].slice(-500),
  };
  const turn = eventTurn(event);
  if (event.event === 'turn_started' && turn) {
    next.active_turn = turn;
    next.thread_status = { type: 'active', active_flags: [] };
    if (next.plan?.turn_id !== turn.id) next.plan = null;
  } else if ((event.event === 'turn_completed' || event.event === 'turn_end') && turn) {
    next.latest_turn = turn;
    if (!next.active_turn || next.active_turn.id === turn.id) {
      next.active_turn = null;
      next.thread_status = { type: 'idle' };
    }
  } else if (event.event === 'thread_status_changed') {
    const status = event.thread_status
      ?? (event.payload && typeof event.payload === 'object'
        ? event.payload.thread_status
        : undefined);
    if (status && typeof status === 'object' && 'type' in status) {
      next.thread_status = status as ThreadResource['thread_status'];
    }
  }
  const plan = eventPlan(event);
  if (
    plan
    && (!next.plan || next.plan.turn_id !== plan.turn_id || next.plan.revision <= plan.revision)
  ) {
    next.plan = plan;
  }
  return next;
}

/**
 * Renderer mirror of the gateway Thread Resource.
 *
 * The store is intentionally keyed by the canonical session key.  It never
 * guesses project/session ownership and it fails closed on sequence gaps;
 * callers then replace the resource from the REST snapshot.
 */
export const useThreadResourceStore = create<ThreadResourceState>((set, get) => ({
  resourcesBySession: {},
  resyncRequiredBySession: {},

  replaceSnapshot: (resource) => {
    if (!validResource(resource)) return false;
    const key = sessionKey(resource.session_key);
    const previous = get().resourcesBySession[key];
    if (
      previous
      && (
        previous.project_id !== resource.project_id
        || previous.session_id !== resource.session_id
      )
    ) {
      console.error('[ThreadResourceStore] rejected snapshot identity change', {
        key,
        previousProjectId: previous.project_id,
        nextProjectId: resource.project_id,
        previousSessionId: previous.session_id,
        nextSessionId: resource.session_id,
      });
      return false;
    }
    if (
      previous
      && previous.runtime_epoch === resource.runtime_epoch
      && resource.snapshot_revision < previous.snapshot_revision
    ) {
      return false;
    }
    set((state) => ({
      resourcesBySession: {
        ...state.resourcesBySession,
        [key]: resource,
      },
      resyncRequiredBySession: {
        ...state.resyncRequiredBySession,
        [key]: resource.resync_required,
      },
    }));
    return true;
  },

  applyRuntimeSnapshot: (conversationId, snapshot) => {
    const key = sessionKey(conversationId);
    const previous = get().resourcesBySession[key];
    if (!previous) return false;
    if (
      (snapshot.project_id && snapshot.project_id !== previous.project_id)
      || (snapshot.session_id && snapshot.session_id !== previous.session_id)
    ) {
      return false;
    }
    if (
      previous.runtime_epoch === snapshot.runtime_epoch
      && snapshot.snapshot_revision < previous.runtime_snapshot_revision
    ) {
      return false;
    }
    set((state) => ({
      resourcesBySession: {
        ...state.resourcesBySession,
        [key]: {
          ...previous,
          runtime_snapshot_revision: snapshot.snapshot_revision,
          runtime_epoch: snapshot.runtime_epoch,
          thread_status: snapshot.thread_status,
          active_turn: snapshot.active_turn,
          latest_turn: snapshot.latest_turn,
          plan: (() => {
            const snapshotTurn = snapshot.active_turn ?? snapshot.latest_turn;
            if (!snapshotTurn) return null;
            const snapshotPlan = snapshotTurn.plan;
            if (snapshotPlan) {
              if (
                previous.plan?.turn_id === snapshotPlan.turn_id
                && previous.plan.revision > snapshotPlan.revision
              ) {
                return previous.plan;
              }
              return snapshotPlan;
            }
            return previous.plan?.turn_id === snapshotTurn.id
              ? previous.plan
              : null;
          })(),
        },
      },
    }));
    return true;
  },

  applyPlanResource: (conversationId, plan) => {
    const key = sessionKey(conversationId);
    const previous = get().resourcesBySession[key];
    if (!previous) return false;
    if (
      (plan.project_id && plan.project_id !== previous.project_id)
      || (plan.session_id && plan.session_id !== previous.session_id)
    ) {
      return false;
    }
    const knownTurnIds = new Set(
      [previous.active_turn?.id, previous.latest_turn?.id].filter(Boolean),
    );
    if (knownTurnIds.size > 0 && !knownTurnIds.has(plan.turn_id)) return false;
    if (
      previous.plan?.turn_id === plan.turn_id
      && previous.plan.revision > plan.revision
    ) {
      return false;
    }
    set((state) => ({
      resourcesBySession: {
        ...state.resourcesBySession,
        [key]: {
          ...previous,
          plan,
        },
      },
    }));
    return true;
  },

  applyCanonicalEvent: (event) => {
    const key = sessionKey(event.session_key);
    const previous = get().resourcesBySession[key];
    if (!previous) return 'missing_snapshot';
    if (
      event.project_id !== previous.project_id
      || event.session_id !== previous.session_id
      || sessionKey(event.session_key) !== sessionKey(previous.session_key)
    ) {
      return 'identity_mismatch';
    }
    if (event.event_seq <= previous.last_event_seq) return 'duplicate';
    if (event.event_seq !== previous.last_event_seq + 1) {
      set((state) => ({
        resyncRequiredBySession: {
          ...state.resyncRequiredBySession,
          [key]: true,
        },
      }));
      return 'gap';
    }
    const next = withCanonicalEvent(previous, event);
    set((state) => ({
      resourcesBySession: {
        ...state.resourcesBySession,
        [key]: next,
      },
    }));
    return 'applied';
  },

  markResyncRequired: (conversationId) => {
    const key = sessionKey(conversationId);
    set((state) => ({
      resyncRequiredBySession: {
        ...state.resyncRequiredBySession,
        [key]: true,
      },
    }));
  },

  clearSession: (conversationId) => {
    const key = sessionKey(conversationId);
    set((state) => {
      const resources = { ...state.resourcesBySession };
      const resync = { ...state.resyncRequiredBySession };
      delete resources[key];
      delete resync[key];
      return {
        resourcesBySession: resources,
        resyncRequiredBySession: resync,
      };
    });
  },
}));

export function threadResourceForConversation(
  conversationId: string | null | undefined,
): ThreadResource | undefined {
  if (!conversationId) return undefined;
  return useThreadResourceStore.getState().resourcesBySession[sessionKey(conversationId)];
}
