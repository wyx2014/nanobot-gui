import type { ThreadResource, ThreadRuntimeSnapshot } from '@/core/types';
import { useConversationWorkbenchStore } from '@/stores/conversationWorkbenchStore';
import { useThreadResourceStore } from '@/stores/threadResourceStore';
import { useTurnPlanStore } from '@/stores/turnPlanStore';
import { conversationIdToSessionKey } from '@/core/sessionKey';
import { recordDiagnostic } from '@/core/diagnostics';

export function runtimeSnapshotFromThread(
  resource: ThreadResource,
): ThreadRuntimeSnapshot {
  return {
    session_key: resource.session_key,
    project_id: resource.project_id,
    session_id: resource.session_id,
    runtime_epoch: resource.runtime_epoch,
    snapshot_revision: resource.runtime_snapshot_revision,
    thread_status: resource.thread_status,
    active_turn: resource.active_turn,
    latest_turn: resource.latest_turn,
  };
}

/** Apply the non-message portions of a Thread Resource as one atomic snapshot.
 * Compatibility stores remain renderer views; none of them derive ownership
 * or running state independently. */
export function projectThreadResource(
  conversationId: string,
  resource: ThreadResource,
): ThreadRuntimeSnapshot | null {
  const expectedSessionKey = conversationIdToSessionKey(conversationId);
  const actualSessionKey = conversationIdToSessionKey(resource.session_key);
  if (expectedSessionKey !== actualSessionKey) {
    recordDiagnostic({ event_name: 'renderer.snapshot_rejected', chat_id: conversationId, level: 'error', details: { error_code: 'CROSS_SESSION_SNAPSHOT' } });
    console.error('[ThreadResourceProjection] rejected cross-session snapshot', {
      expectedSessionKey,
      actualSessionKey,
    });
    return null;
  }
  if (!useThreadResourceStore.getState().replaceSnapshot(resource)) {
    recordDiagnostic({ event_name: 'renderer.snapshot_rejected', chat_id: conversationId, details: { stage: 'revision_guard' } });
    return null;
  }
  recordDiagnostic({ event_name: 'renderer.snapshot_applied', chat_id: conversationId, session_id: resource.session_id ?? undefined, details: { snapshot_revision: resource.runtime_snapshot_revision, runtime_epoch: resource.runtime_epoch } });

  const planStore = useTurnPlanStore.getState();
  planStore.clearConversation(conversationId);
  const turn = resource.active_turn ?? resource.latest_turn;
  if (turn?.id) planStore.activateTurn(conversationId, turn.id);
  if (resource.plan) planStore.applyPlan(conversationId, resource.plan);

  useConversationWorkbenchStore.getState().setArtifactRevision(
    conversationId,
    resource.artifact_revision,
  );
  return runtimeSnapshotFromThread(resource);
}
