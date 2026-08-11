import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

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
