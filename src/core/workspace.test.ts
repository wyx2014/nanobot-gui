import { describe, expect, it } from 'vitest';
import {
  conversationBelongsToProject,
  isDefaultWorkspacePath,
  normalizeProjectPath,
  projectNameFromPath,
  sameWorkspacePath,
  visibleProjectPath,
} from './workspace';

describe('workspace project helpers', () => {
  it('normalizes separators and trailing slashes', () => {
    expect(normalizeProjectPath('C:\\Users\\me\\project\\')).toBe('C:/Users/me/project');
  });

  it('uses the final path segment as project name', () => {
    expect(projectNameFromPath('/Users/me/nanobot-gui/')).toBe('nanobot-gui');
    expect(projectNameFromPath('C:\\Users\\1\\Documents\\TPACowork Projects\\123123\\')).toBe('123123');
  });

  it('treats workspace as the default workspace, not a visible project', () => {
    expect(isDefaultWorkspacePath('/Users/me/workspace')).toBe(true);
    expect(visibleProjectPath('/Users/me/workspace')).toBeNull();
  });

  it('keeps cached legacy default-workspace paths out of the project list', () => {
    expect(isDefaultWorkspacePath('/Users/me/nanobot-workspace')).toBe(true);
    expect(visibleProjectPath('/Users/me/nanobot-workspace')).toBeNull();
  });

  it('compares Windows paths without drive-letter or segment casing differences', () => {
    expect(sameWorkspacePath(
      'C:\\Users\\Me\\nanobot-workdir',
      'c:/users/me/NANOBOT-WORKDIR/',
    )).toBe(true);
  });

  it('matches every cached conversation reference belonging to a removed project', () => {
    expect(conversationBelongsToProject(
      { projectId: 'project-1', workspacePath: null },
      'C:/work/nanobot-workdir',
      'project-1',
    )).toBe(true);
    expect(conversationBelongsToProject(
      { workspaceScope: { project_path: 'c:\\WORK\\nanobot-workdir' } },
      'C:/work/nanobot-workdir',
    )).toBe(true);
    expect(conversationBelongsToProject(
      { workspacePath: 'C:/work/other' },
      'C:/work/nanobot-workdir',
    )).toBe(false);
  });
});
