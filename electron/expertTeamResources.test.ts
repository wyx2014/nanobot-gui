import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

describe('built-in expert-team resources', () => {
  it('exposes only the runtime-owned stock research entry as a workflow', () => {
    const manifestPath = path.join(
      process.cwd(),
      'resources',
      'expert-teams',
      'asset-research-team',
      'team.yaml',
    );
    const manifest = parseYaml(fs.readFileSync(manifestPath, 'utf8')) as {
      entry_workflow?: string;
      workflows?: Array<{ id?: string }>;
    };

    expect(manifest.entry_workflow).toBe('investment-team');
    expect(manifest.workflows?.map((workflow) => workflow.id)).toEqual([
      manifest.entry_workflow,
    ]);
  });
});
