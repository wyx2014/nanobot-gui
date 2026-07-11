import type { GoalStateWsPayload } from '@/core/types';
import type { StreamError } from '@/core/nanobot-client';

/** Protocol-owned state. Message projection remains in the stream binding so
 * React can batch token frames independently from control-plane updates. */
export interface StreamProtocolState {
  isStreaming: boolean;
  runStartedAt: number | null;
  goalState: GoalStateWsPayload | undefined;
  streamError: StreamError | null;
}

export type StreamProtocolAction =
  | { type: 'reset'; isStreaming: boolean; runStartedAt: number | null; goalState: GoalStateWsPayload | undefined }
  | { type: 'streaming'; value: boolean }
  | { type: 'goal_state'; value: GoalStateWsPayload | undefined }
  | { type: 'goal_status'; status: string; startedAt?: number }
  | { type: 'error'; value: StreamError | null }
  | { type: 'turn_end'; goalState?: GoalStateWsPayload };

export const initialStreamProtocolState: StreamProtocolState = {
  isStreaming: false,
  runStartedAt: null,
  goalState: undefined,
  streamError: null,
};

export function streamProtocolReducer(
  state: StreamProtocolState,
  action: StreamProtocolAction,
): StreamProtocolState {
  switch (action.type) {
    case 'reset':
      return {
        isStreaming: action.isStreaming,
        runStartedAt: action.runStartedAt,
        goalState: action.goalState,
        streamError: null,
      };
    case 'streaming':
      return state.isStreaming === action.value ? state : { ...state, isStreaming: action.value };
    case 'goal_state':
      return state.goalState === action.value ? state : { ...state, goalState: action.value };
    case 'goal_status':
      return {
        ...state,
        runStartedAt: action.status === 'running' && typeof action.startedAt === 'number'
          ? action.startedAt
          : null,
      };
    case 'error':
      return state.streamError === action.value ? state : { ...state, streamError: action.value };
    case 'turn_end':
      return {
        ...state,
        isStreaming: false,
        runStartedAt: null,
        ...(action.goalState ? { goalState: action.goalState } : {}),
      };
  }
}
