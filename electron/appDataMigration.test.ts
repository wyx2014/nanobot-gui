import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applicationUserDataPath,
  defaultWorkspacePath,
  migrateDirectory,
  migrateLegacyApplicationData,
  migrateLegacyDefaultWorkspace,
  migrateLegacyUserProjects,
  migratePersistedWorkspaceReferences,
  migratePersistedWorkspaceReferencesOnce,
} from './appDataMigration';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tpacowork-migration-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('application data migration', () => {
  it('uses the tpacowork application data directory', () => {
    expect(applicationUserDataPath(path.join('/Users', 'demo', 'Library', 'Application Support')))
      .toBe(path.join('/Users', 'demo', 'Library', 'Application Support', 'tpacowork'));
    expect(defaultWorkspacePath(path.join('/Users', 'demo', 'Library', 'Application Support', 'tpacowork')))
      .toBe(path.join('/Users', 'demo', 'Library', 'Application Support', 'tpacowork', 'workspace'));
  });

  it('moves the legacy application data directory and removes the old path', () => {
    const appDataRoot = temporaryDirectory();
    const legacyConfig = path.join(appDataRoot, 'tparuyi', 'nanobot-workspace', '.nanobot', 'config.json');
    fs.mkdirSync(path.dirname(legacyConfig), { recursive: true });
    fs.writeFileSync(legacyConfig, '{"model":"demo"}');

    const result = migrateLegacyApplicationData(appDataRoot);
    const workspaceResult = migrateLegacyDefaultWorkspace(applicationUserDataPath(appDataRoot));
    const migratedConfig = path.join(appDataRoot, 'tpacowork', 'workspace', '.nanobot', 'config.json');

    expect(result.status).toBe('moved');
    expect(workspaceResult.status).toBe('moved');
    expect(fs.existsSync(path.join(appDataRoot, 'tparuyi'))).toBe(false);
    expect(fs.existsSync(path.join(appDataRoot, 'tpacowork', 'nanobot-workspace'))).toBe(false);
    expect(fs.readFileSync(migratedConfig, 'utf8')).toBe('{"model":"demo"}');
  });

  it('renames the legacy default workspace without replacing its filesystem identity', () => {
    const userDataRoot = temporaryDirectory();
    const legacyWorkspace = path.join(userDataRoot, 'nanobot-workspace');
    fs.mkdirSync(path.join(legacyWorkspace, '.nanobot'), { recursive: true });
    fs.writeFileSync(path.join(legacyWorkspace, '.nanobot', 'state.sqlite'), 'state');
    const legacyIdentity = fs.statSync(legacyWorkspace).ino;

    const result = migrateLegacyDefaultWorkspace(userDataRoot);
    const workspace = path.join(userDataRoot, 'workspace');

    expect(result.status).toBe('moved');
    expect(fs.existsSync(legacyWorkspace)).toBe(false);
    expect(fs.statSync(workspace).ino).toBe(legacyIdentity);
    expect(fs.readFileSync(path.join(workspace, '.nanobot', 'state.sqlite'), 'utf8')).toBe('state');
  });

  it('merges an existing workspace into the legacy root before renaming it', () => {
    const userDataRoot = temporaryDirectory();
    const legacyWorkspace = path.join(userDataRoot, 'nanobot-workspace');
    const workspace = path.join(userDataRoot, 'workspace');
    fs.mkdirSync(legacyWorkspace, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(legacyWorkspace, 'settings.json'), 'legacy-current');
    fs.writeFileSync(path.join(workspace, 'settings.json'), 'premature-target');
    fs.writeFileSync(path.join(workspace, 'target-only.txt'), 'kept');
    const legacyIdentity = fs.statSync(legacyWorkspace).ino;

    const result = migrateLegacyDefaultWorkspace(userDataRoot);

    expect(result.status).toBe('merged');
    expect(fs.existsSync(legacyWorkspace)).toBe(false);
    expect(fs.statSync(workspace).ino).toBe(legacyIdentity);
    expect(fs.readFileSync(path.join(workspace, 'settings.json'), 'utf8')).toBe('legacy-current');
    expect(fs.readFileSync(path.join(workspace, 'target-only.txt'), 'utf8')).toBe('kept');
    expect(fs.readFileSync(path.join(workspace, '.migration-conflicts', 'settings.json'), 'utf8'))
      .toBe('premature-target');
  });

  it('merges into an existing target without overwriting either copy', () => {
    const root = temporaryDirectory();
    const legacy = path.join(root, 'legacy');
    const current = path.join(root, 'current');
    fs.mkdirSync(legacy, { recursive: true });
    fs.mkdirSync(current, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'settings.json'), 'legacy');
    fs.writeFileSync(path.join(legacy, 'only-legacy.json'), 'migrated');
    fs.writeFileSync(path.join(current, 'settings.json'), 'current');

    const result = migrateDirectory(legacy, current);

    expect(result.status).toBe('merged');
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(path.join(current, 'settings.json'), 'utf8')).toBe('current');
    expect(fs.readFileSync(path.join(current, 'only-legacy.json'), 'utf8')).toBe('migrated');
    expect(fs.readFileSync(path.join(current, '.migration-conflicts', 'settings.json'), 'utf8'))
      .toBe('legacy');
  });

  it('renames the user project root to TPACowork Projects', () => {
    const documentsRoot = temporaryDirectory();
    const legacyProject = path.join(documentsRoot, 'TpaRuyi Projects', '年度报告');
    fs.mkdirSync(legacyProject, { recursive: true });
    fs.writeFileSync(path.join(legacyProject, 'README.md'), '# migrated');

    const result = migrateLegacyUserProjects(documentsRoot);
    const migratedProject = path.join(documentsRoot, 'TPACowork Projects', '年度报告');

    expect(result.status).toBe('moved');
    expect(fs.existsSync(path.join(documentsRoot, 'TpaRuyi Projects'))).toBe(false);
    expect(fs.readFileSync(path.join(migratedProject, 'README.md'), 'utf8')).toBe('# migrated');
  });

  it('rewrites durable session and event paths after directory migration', () => {
    const workspace = temporaryDirectory();
    const oldProjects = path.join(workspace, 'TpaRuyi Projects');
    const newProjects = path.join(workspace, 'TPACowork Projects');
    const sessionFile = path.join(workspace, 'sessions', 'websocket_chat.jsonl');
    const transcriptFile = path.join(workspace, '.nanobot', 'webui', 'websocket_chat.jsonl');
    const lifecycleFile = path.join(workspace, '.nanobot', 'lifecycle.jsonl');
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.mkdirSync(path.dirname(transcriptFile), { recursive: true });
    fs.writeFileSync(sessionFile, `${JSON.stringify({
      _type: 'metadata',
      metadata: { workspace_scope: { project_path: path.join(oldProjects, 'demo') } },
    })}\n`);
    fs.writeFileSync(transcriptFile, `${JSON.stringify({
      event: 'file_edit',
      absolute_path: path.join(oldProjects, 'demo', 'report.md'),
    })}\n`);
    fs.writeFileSync(lifecycleFile, `${JSON.stringify({
      metadata: { canonical_root_path: path.join(oldProjects, 'demo') },
    })}\n`);

    const first = migratePersistedWorkspaceReferences(workspace, [{
      source: oldProjects,
      target: newProjects,
    }]);
    const second = migratePersistedWorkspaceReferences(workspace, [{
      source: oldProjects,
      target: newProjects,
    }]);

    expect(first.updatedFiles).toBe(3);
    expect(second.updatedFiles).toBe(0);
    for (const file of [sessionFile, transcriptFile, lifecycleFile]) {
      expect(fs.readFileSync(file, 'utf8')).toContain(newProjects);
      expect(fs.readFileSync(file, 'utf8')).not.toContain(oldProjects);
    }
  });

  it('does not cold-scan retained histories again after a completed path migration', () => {
    const userData = temporaryDirectory();
    const workspace = path.join(userData, 'workspace');
    const marker = path.join(userData, '.persisted-path-migration-v1.json');
    const sessionFile = path.join(workspace, 'sessions', 'websocket_chat.jsonl');
    const oldRoot = path.join(userData, 'nanobot-workspace');
    const newRoot = workspace;
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, JSON.stringify({ project_path: oldRoot }));

    const first = migratePersistedWorkspaceReferencesOnce(workspace, marker, [{
      source: oldRoot,
      target: newRoot,
    }]);
    fs.writeFileSync(sessionFile, JSON.stringify({ project_path: oldRoot }));
    const second = migratePersistedWorkspaceReferencesOnce(workspace, marker, [{
      source: oldRoot,
      target: newRoot,
    }]);

    expect(first).toMatchObject({ skipped: false, scannedFiles: 1, updatedFiles: 1 });
    expect(second).toEqual({ skipped: true, scannedFiles: 0, updatedFiles: 0 });
    expect(fs.existsSync(marker)).toBe(true);
    expect(fs.readFileSync(sessionFile, 'utf8')).toContain(oldRoot);
  });
});
