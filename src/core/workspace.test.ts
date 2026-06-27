import { describe, expect, it } from 'vitest';
import {
  isDefaultWorkspacePath,
  normalizeProjectPath,
  projectNameFromPath,
  visibleProjectPath,
} from './workspace';

describe('workspace project helpers', () => {
  it('normalizes separators and trailing slashes', () => {
    expect(normalizeProjectPath('C:\\Users\\me\\project\\')).toBe('C:/Users/me/project');
  });

  it('uses the final path segment as project name', () => {
    expect(projectNameFromPath('/Users/me/nanobot-gui/')).toBe('nanobot-gui');
  });

  it('treats nanobot-workspace as the default workspace, not a visible project', () => {
    expect(isDefaultWorkspacePath('/Users/me/nanobot-workspace')).toBe(true);
    expect(visibleProjectPath('/Users/me/nanobot-workspace')).toBeNull();
  });
});
