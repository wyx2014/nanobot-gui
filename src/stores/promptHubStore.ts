import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { loginPromptHub, type PromptHubUser } from '@/core/prompthubApi';

interface PromptHubState {
  baseUrl: string;
  token: string | null;
  user: PromptHubUser | null;
  isLoggingIn: boolean;
  error: string | null;
}

interface PromptHubActions {
  setBaseUrl: (baseUrl: string) => void;
  login: (username: string, passwordHash: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

export type PromptHubStore = PromptHubState & PromptHubActions;

export const usePromptHubStore = create<PromptHubStore>()(
  persist(
    (set, get) => ({
      baseUrl: 'http://localhost:8080',
      token: null,
      user: null,
      isLoggingIn: false,
      error: null,

      setBaseUrl: (baseUrl) => set({ baseUrl: baseUrl.trim() || 'http://localhost:8080' }),

      login: async (username, passwordHash) => {
        set({ isLoggingIn: true, error: null });
        try {
          const data = await loginPromptHub(get().baseUrl, username.trim(), passwordHash);
          set({ token: data.token, user: data.user, isLoggingIn: false });
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
      version: 1,
      partialize: (state) => ({
        baseUrl: state.baseUrl,
        token: state.token,
        user: state.user,
      }),
    },
  ),
);
