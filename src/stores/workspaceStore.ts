import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authorizeWorkspace, revokeWorkspace } from '../core/safety/pathSafety';
import { getBaseName } from '../utils/pathUtils';
import { normalizeProjectPath, sameWorkspacePath, visibleProjectPath } from '@/core/workspace';
import type { ProjectPayload } from '@/core/types';

interface WorkspaceState {
  /** User-selected workspace path (null if user hasn't selected one) */
  currentPath: string | null;
  recentPaths: string[];
  /** Gateway-owned project registry. recentPaths remains migration/UI fallback only. */
  projects: ProjectPayload[];
  /** True after the gateway project registry has completed its first sync. */
  projectsHydrated: boolean;
  projectNames: Record<string, string>;
  projectSkillBindings: Record<string, string[]>;
}

interface WorkspaceActions {
  setWorkspace: (path: string | null) => void;
  setProjects: (projects: ProjectPayload[]) => void;
  clearWorkspace: () => void;
  removeRecentPath: (path: string) => void;
  setProjectName: (path: string, name: string) => void;
  setProjectSkillBindings: (path: string, skillNames: string[]) => void;
  removeProjectSkillBinding: (skillName: string) => void;
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions;

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      currentPath: null,
      recentPaths: [],
      projects: [],
      projectsHydrated: false,
      projectNames: {},
      projectSkillBindings: {},

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
        const visiblePath = visibleProjectPath(path);
        if (!visiblePath) {
          set({ currentPath: path });
          return;
        }
        // Add to recent paths, removing duplicates
        const filtered = recentPaths.filter((p) => !sameWorkspacePath(p, visiblePath));
        const updated = [visiblePath, ...filtered];

        set({
          currentPath: path,
          recentPaths: updated,
        });
      },

      setProjects: (projects) => {
        const unique = new Map<string, ProjectPayload>();
        for (const project of projects) {
          if (!project?.id) continue;
          unique.set(project.id, project);
        }
        set({ projects: [...unique.values()], projectsHydrated: true });
      },

      clearWorkspace: () => {
        const { currentPath } = get();
        if (currentPath) {
          revokeWorkspace(currentPath);
        }
        set({ currentPath: null });
      },

      removeRecentPath: (path) => {
        set((state) => {
          const projectNames = Object.fromEntries(
            Object.entries(state.projectNames).filter(([key]) => !sameWorkspacePath(key, path)),
          );
          const projectSkillBindings = Object.fromEntries(
            Object.entries(state.projectSkillBindings).filter(([key]) => !sameWorkspacePath(key, path)),
          );
          return {
            currentPath: sameWorkspacePath(state.currentPath, path) ? null : state.currentPath,
            recentPaths: state.recentPaths.filter((p) => !sameWorkspacePath(p, path)),
            projectNames,
            projectSkillBindings,
          };
        });
      },

      setProjectName: (path, name) => {
        const normalized = normalizeProjectPath(path);
        set((state) => ({
          projectNames: {
            ...state.projectNames,
            [normalized]: name,
          },
        }));
      },

      setProjectSkillBindings: (path, skillNames) => {
        const normalized = normalizeProjectPath(path);
        const unique = [...new Set(skillNames.map((name) => name.trim()).filter(Boolean))];
        set((state) => ({
          projectSkillBindings: {
            ...state.projectSkillBindings,
            [normalized]: unique,
          },
        }));
      },

      removeProjectSkillBinding: (skillName) => {
        set((state) => ({
          projectSkillBindings: Object.fromEntries(
            Object.entries(state.projectSkillBindings).map(([path, names]) => [
              path,
              names.filter((name) => name !== skillName),
            ]),
          ),
        }));
      },
    }),
    {
      name: 'ruyi-workspace',
      version: 1,
      // Only persist recentPaths — currentPath is now derived from active conversation
      partialize: (state) => ({
        recentPaths: state.recentPaths,
        projectNames: state.projectNames,
        projectSkillBindings: state.projectSkillBindings,
      }),
    }
  )
);

/** Get the folder name from a full path */
export function getFolderName(path: string): string {
  return getBaseName(path);
}
