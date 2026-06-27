import type { WorkspaceAccessMode, WorkspaceScopePayload } from '@/core/types';

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

export function isDefaultWorkspacePath(path: string | null | undefined): boolean {
  if (!path) return false;
  return projectNameFromPath(path) === 'nanobot-workspace';
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
  return normalizeProjectPath(a) === normalizeProjectPath(b);
}
