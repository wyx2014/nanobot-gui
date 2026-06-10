import type { ExecutionStep } from '../../types/execution';
import type { ExecutionStepSnapshot } from '../../types/execution';

/**
 * Convert full ExecutionStep[] to compact ExecutionStepSnapshot[] for persistence.
 * Strips large fields (toolInput, toolResult) and keeps only display-relevant data.
 */
export function snapshotExecutionSteps(steps: ExecutionStep[]): ExecutionStepSnapshot[] {
  return steps.map(snapshotStep);
}

function snapshotStep(step: ExecutionStep): ExecutionStepSnapshot {
  const snapshot: ExecutionStepSnapshot = {
    id: step.id,
    type: step.type,
    label: step.label,
    status: step.status === 'error' ? 'error' : 'completed',
    toolName: step.toolName,
  };

  if (step.duration != null) {
    snapshot.duration = step.duration;
  }

  if (step.agentName) {
    snapshot.agentName = step.agentName;
  }

  if (step.childSteps && step.childSteps.length > 0) {
    snapshot.childSteps = step.childSteps.map(snapshotStep);
  }

  if (step.detailBlocks.length > 0) {
    snapshot.detailBlocks = step.detailBlocks.map((b) => {
      // Truncate content for persistence (keep first 500 chars)
      const maxLen = 500;
      const truncated = b.content.length > maxLen
        ? b.content.slice(0, maxLen) + '...'
        : b.content;
      return {
        id: b.id,
        title: b.label,
        type: b.type,
        content: truncated || undefined,
      };
    });
  }

  return snapshot;
}

/**
 * Convert persisted ExecutionStepSnapshot[] back to ExecutionStep[] shape with defaults.
 * Inverse of snapshotExecutionSteps — used for rendering persisted data.
 */
export function snapshotToExecutionSteps(snapshots: ExecutionStepSnapshot[]): ExecutionStep[] {
  return snapshots.map((s): ExecutionStep => ({
    id: s.id,
    executionId: '',
    type: s.type,
    label: s.label,
    status: s.status,
    toolName: s.toolName,
    toolInput: {},
    source: 'agent',
    detailBlocks: s.detailBlocks?.filter((b) => b.content).map((b) => ({
      id: b.id,
      stepId: s.id,
      type: b.type,
      label: b.title,
      content: b.content || '',
      isTruncated: b.content ? b.content.endsWith('...') : false,
      isExpanded: false,
    })) ?? [],
    duration: s.duration,
    agentName: s.agentName,
    childSteps: s.childSteps ? snapshotToExecutionSteps(s.childSteps) : undefined,
  }));
}
