import fs from 'node:fs';
import path from 'node:path';
import {
  APPLICATION_DATA_DIRECTORY_NAME,
  DEFAULT_WORKSPACE_DIRECTORY_NAME,
  LEGACY_APPLICATION_DATA_DIRECTORY_NAME,
  LEGACY_DEFAULT_WORKSPACE_DIRECTORY_NAME,
  LEGACY_USER_PROJECTS_DIRECTORY_NAME,
  USER_PROJECTS_DIRECTORY_NAME,
} from '../src/config/appDirectories';

export type DirectoryMigrationStatus = 'not-found' | 'moved' | 'merged';

export interface DirectoryMigrationResult {
  source: string;
  target: string;
  status: DirectoryMigrationStatus;
  conflictsDirectory?: string;
}

export interface PersistedPathReplacement {
  source: string;
  target: string;
}

export interface PersistedPathMigrationResult {
  scannedFiles: number;
  updatedFiles: number;
}

const MIGRATION_CONFLICTS_DIRECTORY_NAME = '.migration-conflicts';

function movePath(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    fs.cpSync(source, target, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    });
    fs.rmSync(source, { recursive: true, force: true });
  }
}

function availableConflictPath(conflictsDirectory: string, relativePath: string): string {
  const preferred = path.join(conflictsDirectory, relativePath);
  if (!fs.existsSync(preferred)) return preferred;

  let suffix = 1;
  while (fs.existsSync(`${preferred}.${suffix}`)) suffix += 1;
  return `${preferred}.${suffix}`;
}

function mergeDirectory(
  source: string,
  target: string,
  conflictsDirectory: string,
  relativeDirectory = '',
): void {
  fs.mkdirSync(target, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (!fs.existsSync(targetPath)) {
      movePath(sourcePath, targetPath);
      continue;
    }

    const targetStat = fs.lstatSync(targetPath);
    if (entry.isDirectory() && targetStat.isDirectory() && !targetStat.isSymbolicLink()) {
      mergeDirectory(sourcePath, targetPath, conflictsDirectory, relativePath);
      continue;
    }

    movePath(sourcePath, availableConflictPath(conflictsDirectory, relativePath));
  }

  fs.rmSync(source, { recursive: true, force: true });
}

/** Move a legacy directory once. Existing target files always win. */
export function migrateDirectory(source: string, target: string): DirectoryMigrationResult {
  if (!fs.existsSync(source)) return { source, target, status: 'not-found' };
  if (path.resolve(source) === path.resolve(target)) return { source, target, status: 'not-found' };

  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) {
    movePath(source, target);
    return { source, target, status: 'moved' };
  }

  const conflictsDirectory = path.join(target, MIGRATION_CONFLICTS_DIRECTORY_NAME);
  mergeDirectory(source, target, conflictsDirectory);
  return { source, target, status: 'merged', conflictsDirectory };
}

export function applicationUserDataPath(appDataRoot: string): string {
  return path.join(appDataRoot, APPLICATION_DATA_DIRECTORY_NAME);
}

export function migrateLegacyApplicationData(appDataRoot: string): DirectoryMigrationResult {
  return migrateDirectory(
    path.join(appDataRoot, LEGACY_APPLICATION_DATA_DIRECTORY_NAME),
    applicationUserDataPath(appDataRoot),
  );
}

export function defaultWorkspacePath(userDataRoot: string): string {
  return path.join(userDataRoot, DEFAULT_WORKSPACE_DIRECTORY_NAME);
}

/**
 * Rename the built-in workspace while retaining the legacy directory inode.
 * StateStore uses that filesystem identity to keep the existing Inbox project
 * and all of its sessions attached after the path changes.
 */
export function migrateLegacyDefaultWorkspace(userDataRoot: string): DirectoryMigrationResult {
  const source = path.join(userDataRoot, LEGACY_DEFAULT_WORKSPACE_DIRECTORY_NAME);
  const target = defaultWorkspacePath(userDataRoot);
  if (!fs.existsSync(source)) return { source, target, status: 'not-found' };

  const targetAlreadyExists = fs.existsSync(target);
  if (targetAlreadyExists) {
    // Fold any prematurely-created target into the legacy root first. The
    // legacy root wins conflicts and, importantly, remains the root we rename.
    migrateDirectory(target, source);
  }

  const result = migrateDirectory(source, target);
  if (!targetAlreadyExists) return result;
  return {
    source,
    target,
    status: 'merged',
    conflictsDirectory: path.join(target, MIGRATION_CONFLICTS_DIRECTORY_NAME),
  };
}

export function migrateLegacyUserProjects(documentsRoot: string): DirectoryMigrationResult {
  return migrateDirectory(
    path.join(documentsRoot, LEGACY_USER_PROJECTS_DIRECTORY_NAME),
    path.join(documentsRoot, USER_PROJECTS_DIRECTORY_NAME),
  );
}

function persistedReferenceFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (candidate: string): void => {
    if (!fs.existsSync(candidate)) return;
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (candidate.endsWith('.json') || candidate.endsWith('.jsonl')) files.push(candidate);
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(candidate)) visit(path.join(candidate, entry));
  };

  visit(path.join(root, 'sessions'));
  visit(path.join(root, 'cron'));
  visit(path.join(root, '.nanobot', 'webui'));
  visit(path.join(root, '.nanobot', 'session-events'));
  visit(path.join(root, '.nanobot', 'lifecycle.jsonl'));
  visit(path.join(root, '.nanobot', 'config.json'));
  return files;
}

function replacePersistedPath(raw: string, replacement: PersistedPathReplacement): string {
  const source = path.resolve(replacement.source);
  const target = path.resolve(replacement.target);
  if (source === target) return raw;
  let updated = raw.split(source).join(target);
  const escapedSource = JSON.stringify(source).slice(1, -1);
  const escapedTarget = JSON.stringify(target).slice(1, -1);
  if (escapedSource !== source) updated = updated.split(escapedSource).join(escapedTarget);
  return updated;
}

/** Rewrite durable JSON/JSONL path references after the directories were moved. */
export function migratePersistedWorkspaceReferences(
  workspaceRoot: string,
  replacements: PersistedPathReplacement[],
): PersistedPathMigrationResult {
  let scannedFiles = 0;
  let updatedFiles = 0;
  for (const file of persistedReferenceFiles(workspaceRoot)) {
    scannedFiles += 1;
    const original = fs.readFileSync(file, 'utf8');
    const updated = replacements.reduce(replacePersistedPath, original);
    if (updated === original) continue;

    const mode = fs.statSync(file).mode;
    const temporary = `${file}.workspace-path-migration-${process.pid}.tmp`;
    const descriptor = fs.openSync(temporary, 'w', mode);
    try {
      fs.writeFileSync(descriptor, updated, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, file);
    updatedFiles += 1;
  }
  return { scannedFiles, updatedFiles };
}
