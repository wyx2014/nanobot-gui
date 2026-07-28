import { create } from 'zustand';
import type { Message } from '@/types';
import type { TaskProgressStep } from '@/core/types';

export type WorkbenchProgressStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'error'
  | 'skipped'
  | 'interrupted';

export interface WorkbenchProgressStep {
  id: string;
  title: string;
  detail?: string;
  status: WorkbenchProgressStatus;
}

export interface WorkbenchProgressSnapshot {
  steps: WorkbenchProgressStep[];
  note?: string;
  isActive: boolean;
  source: 'task_progress' | 'empty';
}

interface ConversationWorkbenchState {
  progressByConversation: Record<string, WorkbenchProgressSnapshot>;
  artifactRevisionByConversation: Record<string, number>;
  setConversationProgress: (
    conversationId: string,
    messages: Message[],
    isActive: boolean,
  ) => void;
  requestArtifactRefresh: (conversationId: string) => void;
  clearConversation: (conversationId: string) => void;
}

function taskProgressSnapshot(
  messages: Message[],
  isActive: boolean,
): WorkbenchProgressSnapshot | null {
  const currentTurn = lastUserTurn(messages);
  const snapshots = currentTurn.flatMap((message) => {
    const agentUI = message.agentUI;
    if (agentUI?.kind !== 'task_progress' || !Array.isArray(agentUI.steps)) return [];
    const steps = agentUI.steps
      .filter((step: TaskProgressStep) => !!step?.title?.trim())
      .map((step: TaskProgressStep) => ({
        id: step.id,
        title: step.title.trim(),
        ...(step.detail?.trim() ? { detail: step.detail.trim() } : {}),
        status: step.status,
      }));
    if (!steps.length) return [];
    return [{
      message,
      agentUI,
      steps,
      isTeam: (
        message.id.startsWith('team-run-')
        || typeof agentUI.team_id === 'string'
        || typeof agentUI.team_run_id === 'string'
      ),
    }];
  });
  if (!snapshots.length) return null;

  // Legacy transcripts may contain several full snapshots. Select one latest
  // revision only; never overlay model and team plans into a third invented
  // state. New sessions use TurnPlanStore and do not enter this fallback.
  const selected = snapshots.reduce((latest, candidate) => (
    (candidate.agentUI.revision ?? 0) >= (latest.agentUI.revision ?? 0)
      ? candidate
      : latest
  ));
  return {
    steps: selected.steps,
    ...(typeof selected.agentUI.note === 'string' && selected.agentUI.note.trim()
      ? { note: selected.agentUI.note.trim() }
      : {}),
    isActive,
    source: 'task_progress',
  };
}

function lastUserTurn(messages: Message[]): Message[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return messages.slice(index + 1);
  }
  return messages;
}

/**
 * Project the renderer's canonical message state into the persistent rail.
 * Progress is an outcome-oriented task plan. Tool activity belongs in the
 * chat's Steps timeline and must never be projected into this surface.
 */
export function deriveWorkbenchProgress(
  messages: Message[],
  isActive: boolean,
): WorkbenchProgressSnapshot {
  return taskProgressSnapshot(messages, isActive)
    ?? { steps: [], isActive, source: 'empty' };
}

export const useConversationWorkbenchStore = create<ConversationWorkbenchState>((set) => ({
  progressByConversation: {},
  artifactRevisionByConversation: {},

  setConversationProgress: (conversationId, messages, isActive) => {
    const snapshot = deriveWorkbenchProgress(messages, isActive);
    set((state) => ({
      progressByConversation: {
        ...state.progressByConversation,
        [conversationId]: snapshot,
      },
    }));
  },

  requestArtifactRefresh: (conversationId) => {
    set((state) => ({
      artifactRevisionByConversation: {
        ...state.artifactRevisionByConversation,
        [conversationId]: (state.artifactRevisionByConversation[conversationId] ?? 0) + 1,
      },
    }));
  },

  clearConversation: (conversationId) => {
    set((state) => {
      const nextProgress = { ...state.progressByConversation };
      const nextArtifactRevisions = { ...state.artifactRevisionByConversation };
      delete nextProgress[conversationId];
      delete nextArtifactRevisions[conversationId];
      return {
        progressByConversation: nextProgress,
        artifactRevisionByConversation: nextArtifactRevisions,
      };
    });
  },
}));
