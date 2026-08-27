import type { WorkspaceAccessMode, WorkspaceScopePayload } from '@/core/types';
import {
  DEFAULT_WORKSPACE_DIRECTORY_NAME,
  LEGACY_USER_PROJECTS_DIRECTORY_NAME,
  LEGACY_DEFAULT_WORKSPACE_DIRECTORY_NAME,
  PREVIOUS_USER_PROJECTS_DIRECTORY_NAME,
  USER_PROJECTS_DIRECTORY_NAME,
} from '@/config/appDirectories';

interface WorkspaceBoundConversation {
  projectId?: string;
  workspacePath?: string | null;
  workspaceScope?: Pick<WorkspaceScopePayload, 'project_path'> | null;
}

export function scopeWithAccessMode(
  scope: WorkspaceScopePayload,
  accessMode: WorkspaceAccessMode,
): WorkspaceScopePayload {
  return {
    ...scope,
    access_mode: accessMode,
    restrict_to_workspace: accessMode === 'restricted',
  };
}

export function projectNameFromPath(path: string): string {
  const normalized = normalizeProjectPath(path);
  return normalized.split('/').filter(Boolean).pop() || path;
}

export function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Rewrite only the two retired TP Cowork-managed project-root segments.
 * Arbitrary user-selected folders are left untouched.
 */
export function migrateLegacyUserProjectPath(path: string): string {
  return normalizeProjectPath(path)
    .split('/')
    .map((segment) => (
      segment === PREVIOUS_USER_PROJECTS_DIRECTORY_NAME
      || segment === LEGACY_USER_PROJECTS_DIRECTORY_NAME
        ? USER_PROJECTS_DIRECTORY_NAME
        : segment
    ))
    .join('/');
}

function projectPathComparisonKey(path: string): string {
  const normalized = normalizeProjectPath(path);
  // Windows drive and UNC paths are case-insensitive. Preserve POSIX casing,
  // where differently-cased paths can legitimately identify different roots.
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized;
}

export function isDefaultWorkspacePath(path: string | null | undefined): boolean {
  if (!path) return false;
  const directoryName = projectNameFromPath(path);
  return directoryName === DEFAULT_WORKSPACE_DIRECTORY_NAME
    || directoryName === LEGACY_DEFAULT_WORKSPACE_DIRECTORY_NAME;
}

export function visibleProjectPath(path: string | null | undefined): string | null {
  if (!path || isDefaultWorkspacePath(path)) return null;
  return normalizeProjectPath(path);
}

export function shortWorkspacePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join('/')}`;
}

export function isAbsoluteWorkspacePath(path: string): boolean {
  const trimmed = path.trim();
  return (
    trimmed === '~'
    || trimmed.startsWith('~/')
    || trimmed.startsWith('~\\')
    || trimmed.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(trimmed)
  );
}

export function sameWorkspacePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return projectPathComparisonKey(a) === projectPathComparisonKey(b);
}

export function conversationBelongsToProject(
  conversation: WorkspaceBoundConversation,
  projectPath: string,
  projectId?: string,
): boolean {
  if (projectId && conversation.projectId === projectId) return true;
  return sameWorkspacePath(
    conversation.workspaceScope?.project_path ?? conversation.workspacePath,
    projectPath,
  );
}
