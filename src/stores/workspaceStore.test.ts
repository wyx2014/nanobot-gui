import { beforeEach, describe, expect, it } from 'vitest';
import { migratePersistedWorkspacePaths, useWorkspaceStore } from './workspaceStore';

describe('workspaceStore project-root migration', () => {
  it('rewrites legacy managed roots and deduplicates the current path', () => {
    expect(migratePersistedWorkspacePaths({
      recentPaths: [
        '/Users/test/Documents/TPACowork Projects/研究',
        '/Users/test/Documents/TPCowork Projects/研究',
        '/Users/test/custom-workspace',
      ],
      projectNames: {
        '/Users/test/Documents/TPACowork Projects/研究': '旧名称',
        '/Users/test/Documents/TPCowork Projects/研究': '当前名称',
      },
      projectSkillBindings: {
        '/Users/test/Documents/TpaRuyi Projects/研究': ['research-skill'],
      },
    })).toEqual({
      recentPaths: [
        '/Users/test/Documents/TPCowork Projects/研究',
        '/Users/test/custom-workspace',
      ],
      projectNames: {
        '/Users/test/Documents/TPCowork Projects/研究': '当前名称',
      },
      projectSkillBindings: {
        '/Users/test/Documents/TPCowork Projects/研究': ['research-skill'],
      },
    });
  });
});

describe('workspaceStore removal', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      currentPath: 'C:\\Users\\Test\\nanobot-workdir',
      recentPaths: [
        'C:\\Users\\Test\\nanobot-workdir',
        'c:/users/test/NANOBOT-WORKDIR/',
        'C:/Users/Test/another-project',
      ],
      projects: [],
      projectsHydrated: true,
      projectNames: {
        'C:/Users/Test/nanobot-workdir': '旧工作空间',
        'C:/Users/Test/another-project': '保留项目',
      },
      projectSkillBindings: {
        'c:/users/test/NANOBOT-WORKDIR': ['old-skill'],
        'C:/Users/Test/another-project': ['keep-skill'],
      },
    });
  });

  it('clears every Windows path alias while preserving unrelated projects', () => {
    useWorkspaceStore.getState().removeRecentPath('c:/users/test/nanobot-workdir');

    const state = useWorkspaceStore.getState();
    expect(state.currentPath).toBeNull();
    expect(state.recentPaths).toEqual(['C:/Users/Test/another-project']);
    expect(state.projectNames).toEqual({
      'C:/Users/Test/another-project': '保留项目',
    });
    expect(state.projectSkillBindings).toEqual({
      'C:/Users/Test/another-project': ['keep-skill'],
    });
  });
});
