import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PROMPT_HUB_BASE_URL } from '@/config/deployment';
import { loginPromptHub, type PromptHubUser } from '@/core/prompthubApi';

interface PromptHubState {
  baseUrl: string;
  token: string | null;
  user: PromptHubUser | null;
  isLoggingIn: boolean;
  loginOpen: boolean;
  error: string | null;
}

interface PromptHubActions {
  openLogin: () => void;
  closeLogin: () => void;
  login: (username: string, passwordHash: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

export type PromptHubStore = PromptHubState & PromptHubActions;

interface PersistedPromptHubState {
  baseUrl?: string;
  token?: string | null;
  user?: PromptHubUser | null;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export const usePromptHubStore = create<PromptHubStore>()(
  persist(
    (set) => ({
      baseUrl: PROMPT_HUB_BASE_URL,
      token: null,
      user: null,
      isLoggingIn: false,
      loginOpen: false,
      error: null,

      openLogin: () => set({ loginOpen: true, error: null }),
      closeLogin: () => set({ loginOpen: false }),

      login: async (username, passwordHash) => {
        set({ isLoggingIn: true, error: null });
        try {
          const data = await loginPromptHub(PROMPT_HUB_BASE_URL, username.trim(), passwordHash);
          set({ token: data.token, user: data.user, isLoggingIn: false, loginOpen: false });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err), isLoggingIn: false });
          throw err;
        }
      },

      logout: () => set({ token: null, user: null, error: null }),
      clearError: () => set({ error: null }),
    }),
    {
      name: 'ruyi-prompthub',
      version: 2,
      migrate: (persistedState) => persistedState as PersistedPromptHubState,
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as PersistedPromptHubState;
        const endpointMatches = normalizeBaseUrl(persisted.baseUrl ?? '')
          === normalizeBaseUrl(PROMPT_HUB_BASE_URL);
        return {
          ...currentState,
          baseUrl: PROMPT_HUB_BASE_URL,
          token: endpointMatches ? persisted.token ?? null : null,
          user: endpointMatches ? persisted.user ?? null : null,
        };
      },
      partialize: (state) => ({
        baseUrl: PROMPT_HUB_BASE_URL,
        token: state.token,
        user: state.user,
      }),
    },
  ),
);
