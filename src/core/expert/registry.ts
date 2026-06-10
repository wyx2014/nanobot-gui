import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { fsBridge, osBridge } from '@/lib/ipc-factory';
import type { ExpertDefinition, ExpertMetadata } from '../../types';
import { joinPath } from '../../utils/pathUtils';

/**
 * Parse an EXPERT.md file: YAML frontmatter + instructions body
 */
export function parseExpertFile(raw: string, filePath: string): ExpertDefinition | null {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return null;

  try {
    const meta = parseYaml(match[1]) as Record<string, unknown>;
    const instructions = match[2].trim();

    if (!meta.name || typeof meta.name !== 'string') return null;

    return {
      name: meta.name as string,
      description: (meta.description as string) ?? '',
      model: meta.model as string | undefined,
      mcpServers: meta.mcpServers as string[] | undefined,
      subagents: meta.subagents as string[] | undefined,
      instructions,
      filePath,
    };
  } catch {
    return null;
  }
}

export class ExpertRegistry {
  private experts: Map<string, ExpertDefinition> = new Map();

  /** Scan directories and load EXPERT.md files */
  async discoverExperts(): Promise<ExpertMetadata[]> {
    this.experts.clear();

    const home = await osBridge.homeDir();
    const projectDir = await osBridge.resolve('.ruyi/experts');

    const dirs = [
      joinPath(home, '.ruyi/experts'),  // user-level
      projectDir,                      // project-level
    ];

    for (const dir of dirs) {
      await this.scanDirectory(dir);
    }

    return this.getAvailableExperts();
  }

  private async scanDirectory(dir: string): Promise<void> {
    try {
      if (!(await fsBridge.exists(dir))) return;

      const entries = await fsBridge.readDir(dir);
      for (const entry of entries) {
        if (!entry.isDirectory) continue;

        const expertPath = joinPath(dir, entry.name, 'EXPERT.md');
        try {
          if (await fsBridge.exists(expertPath)) {
            const raw = await fsBridge.readTextFile(expertPath);
            const expert = parseExpertFile(raw, expertPath);
            if (expert) {
              this.experts.set(expert.name, expert);
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  getAvailableExperts(): ExpertMetadata[] {
    return Array.from(this.experts.values()).map(
      ({ instructions: _, filePath: __, ...meta }) => meta
    );
  }

  getExpert(name: string): ExpertDefinition | undefined {
    return this.experts.get(name);
  }

  has(name: string): boolean {
    return this.experts.has(name);
  }

  /** Re-read a single expert from disk to get latest content */
  async refreshExpert(name: string): Promise<ExpertDefinition | undefined> {
    const existing = this.experts.get(name);
    if (!existing?.filePath) return existing;
    try {
      const raw = await fsBridge.readTextFile(existing.filePath);
      const expert = parseExpertFile(raw, existing.filePath);
      if (expert) {
        this.experts.set(expert.name, expert);
        return expert;
      }
    } catch { /* file might have been deleted */ }
    return existing;
  }
}

export const expertRegistry = new ExpertRegistry();

/**
 * Serialize expert metadata + instructions back to EXPERT.md format (YAML frontmatter + Markdown body)
 */
export function serializeExpertMd(metadata: Partial<ExpertMetadata>, instructions: string): string {
  const meta: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    meta[key] = value;
  };

  set('name', metadata.name);
  set('description', metadata.description);
  set('model', metadata.model);
  set('mcpServers', metadata.mcpServers);
  set('subagents', metadata.subagents);

  const yaml = stringifyYaml(meta, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${instructions}`;
}
