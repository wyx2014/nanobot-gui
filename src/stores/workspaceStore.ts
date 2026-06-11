import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authorizeWorkspace, revokeWorkspace } from '../core/safety/pathSafety';
import { getBaseName } from '../utils/pathUtils';

interface WorkspaceState {
  /** User-selected workspace path (null if user hasn't selected one) */
  currentPath: string | null;
  recentPaths: string[];
}

interface WorkspaceActions {
  setWorkspace: (path: string | null) => void;
  clearWorkspace: () => void;
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions;

const MAX_RECENT_PATHS = 5;

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      currentPath: null,
      recentPaths: [],

      setWorkspace: (path) => {
        const { currentPath: oldPath } = get();

        // Revoke old workspace authorization
        if (oldPath) {
          revokeWorkspace(oldPath);
        }

        if (!path) {
          set({ currentPath: null });
          return;
        }

        // Authorize new workspace for path safety
        authorizeWorkspace(path);

        const { recentPaths } = get();
        // Add to recent paths, removing duplicates and keeping max size
        const filtered = recentPaths.filter((p) => p !== path);
        const updated = [path, ...filtered].slice(0, MAX_RECENT_PATHS);

        set({
          currentPath: path,
          recentPaths: updated,
        });
      },

      clearWorkspace: () => {
        const { currentPath } = get();
        if (currentPath) {
          revokeWorkspace(currentPath);
        }
        set({ currentPath: null });
      },
    }),
    {
      name: 'ruyi-workspace',
      version: 1,
      // Only persist recentPaths — currentPath is now derived from active conversation
      partialize: (state) => ({
        recentPaths: state.recentPaths,
      }),
    }
  )
);

/** Get the folder name from a full path */
export function getFolderName(path: string): string {
  return getBaseName(path);
}
