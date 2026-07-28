import { create } from 'zustand';
import type { Message } from '@/types';
import type { TurnPlanResource } from '@/core/types';
import { normalizeTurnPlan, planFromAgentUI } from '@/core/nanobot/planViewModel';

interface TurnPlanState {
  planByConversation: Record<string, TurnPlanResource>;
  currentTurnByConversation: Record<string, string>;
  activateTurn: (conversationId: string, turnId: string) => void;
  applyPlan: (conversationId: string, plan: TurnPlanResource) => void;
  hydrateLegacyMessages: (
    conversationId: string,
    sourceConversationId: string,
    messages: Message[],
    fallbackTurnId?: string,
  ) => void;
  clearConversation: (conversationId: string) => void;
}

function latestTurnMessages(messages: Message[]): Message[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return messages.slice(index + 1);
  }
  return messages;
}

function isTerminalPlan(plan: TurnPlanResource): boolean {
  return plan.status === 'completed'
    || plan.status === 'failed'
    || plan.status === 'interrupted';
}

export const useTurnPlanStore = create<TurnPlanState>((set, get) => ({
  planByConversation: {},
  currentTurnByConversation: {},

  activateTurn: (conversationId, turnId) => {
    if (!conversationId || !turnId) return;
    const currentTurnId = get().currentTurnByConversation[conversationId];
    if (currentTurnId === turnId) return;
    set((state) => {
      const nextPlans = { ...state.planByConversation };
      delete nextPlans[conversationId];
      return {
        planByConversation: nextPlans,
        currentTurnByConversation: {
          ...state.currentTurnByConversation,
          [conversationId]: turnId,
        },
      };
    });
  },

  applyPlan: (conversationId, rawPlan) => {
    if (!conversationId) return;
    const plan = normalizeTurnPlan(rawPlan);
    const currentTurnId = get().currentTurnByConversation[conversationId];
    if (currentTurnId && currentTurnId !== plan.turn_id) return;
    const previous = get().planByConversation[conversationId];
    if (
      previous
      && previous.turn_id === plan.turn_id
      && (
        previous.revision > plan.revision
        || (
          previous.revision === plan.revision
          && (isTerminalPlan(previous) || !isTerminalPlan(plan))
        )
      )
    ) {
      return;
    }
    set((state) => ({
      planByConversation: {
        ...state.planByConversation,
        [conversationId]: plan,
      },
      currentTurnByConversation: currentTurnId
        ? state.currentTurnByConversation
        : {
            ...state.currentTurnByConversation,
            [conversationId]: plan.turn_id,
          },
    }));
  },

  hydrateLegacyMessages: (
    conversationId,
    sourceConversationId,
    messages,
    fallbackTurnId = conversationId,
  ) => {
    if (!conversationId || sourceConversationId !== conversationId) return;
    const candidates = latestTurnMessages(messages)
      .map((message) => planFromAgentUI(message.agentUI, fallbackTurnId))
      .filter((plan): plan is TurnPlanResource => (
        plan !== null
        && (
          fallbackTurnId === conversationId
          || plan.turn_id === fallbackTurnId
        )
      ));
    const plan = candidates.reduce<TurnPlanResource | null>((latest, candidate) => {
      if (!latest || candidate.revision >= latest.revision) return candidate;
      return latest;
    }, null);
    if (!plan) return;
    // A correctly scoped canonical thread is allowed to repair a turn id that
    // was cached before the runtime snapshot became available. This also
    // self-heals clients that previously associated another chat's legacy plan
    // with this conversation during a fast switch.
    if (
      fallbackTurnId === conversationId
      && get().currentTurnByConversation[conversationId] !== plan.turn_id
    ) {
      get().activateTurn(conversationId, plan.turn_id);
    }
    get().applyPlan(conversationId, plan);
  },

  clearConversation: (conversationId) => {
    set((state) => {
      const nextPlans = { ...state.planByConversation };
      const nextTurns = { ...state.currentTurnByConversation };
      delete nextPlans[conversationId];
      delete nextTurns[conversationId];
      return {
        planByConversation: nextPlans,
        currentTurnByConversation: nextTurns,
      };
    });
  },
}));
