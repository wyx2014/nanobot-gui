import type { ThreadResource, ThreadRuntimeSnapshot } from '@/core/types';
import { useConversationWorkbenchStore } from '@/stores/conversationWorkbenchStore';
import { useThreadResourceStore } from '@/stores/threadResourceStore';
import { useTurnPlanStore } from '@/stores/turnPlanStore';

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
  if (!useThreadResourceStore.getState().replaceSnapshot(resource)) return null;

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
