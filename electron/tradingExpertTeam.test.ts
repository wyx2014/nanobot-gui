import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const teamRoot = path.resolve(process.cwd(), 'resources/expert-teams/trading-analysis-team');
const expectedMembers = [
  'market-analyst',
  'fundamentals-analyst',
  'news-analyst',
  'sentiment-analyst',
  'bull-researcher',
  'bear-researcher',
  'research-manager',
  'trader',
  'aggressive-risk-analyst',
  'conservative-risk-analyst',
  'neutral-risk-analyst',
  'risk-manager',
];

describe('trading analysis expert team package', () => {
  it('ships a complete staged twelve-role workflow', () => {
    const manifest = parse(fs.readFileSync(path.join(teamRoot, 'team.yaml'), 'utf8')) as {
      id: string;
      source_root: string;
      entry_workflow: string;
      runtime: {
        requested_concurrency: number;
        completion: { required_tools: string[]; required_artifacts: string[] };
      };
      data_sources: Array<{ id: string; skill: string; priority: string; required: boolean }>;
      mcp_presets: Array<{ name: string; display_name: string; required: boolean }>;
      members: Array<{ id: string; phase: string; playbook: string }>;
      workflows: Array<{ id: string; source: string }>;
    };

    expect(manifest.id).toBe('trading-analysis-team');
    expect(manifest.runtime.requested_concurrency).toBe(4);
    expect(manifest.runtime.completion.required_tools).toEqual([
      'write_file',
      'create_docx',
      'create_pdf',
    ]);
    expect(manifest.runtime.completion.required_artifacts).toEqual(['html', 'docx', 'pdf']);
    expect(manifest.data_sources).toHaveLength(1);
    expect(manifest.data_sources[0]).toMatchObject({
      id: 'ifind-finance-data',
      skill: 'ifind-finance-data',
      priority: 'primary',
      required: true,
    });
    expect(manifest.mcp_presets).toEqual([
      expect.objectContaining({
        name: 'juyuan',
        display_name: '聚源金融数据 MCP',
        required: false,
      }),
    ]);
    expect(manifest.members.map((member) => member.id)).toEqual(expectedMembers);
    expect(new Set(manifest.members.map((member) => member.phase)).size).toBe(5);

    const sourceRoot = path.join(teamRoot, manifest.source_root);
    for (const member of manifest.members) {
      expect(fs.existsSync(path.join(sourceRoot, member.playbook)), member.id).toBe(true);
    }

    const workflow = manifest.workflows.find((item) => item.id === manifest.entry_workflow);
    expect(workflow).toBeTruthy();
    const workflowText = fs.readFileSync(path.join(sourceRoot, workflow!.source), 'utf8');
    for (const memberId of expectedMembers) {
      expect(workflowText, memberId).toContain(memberId);
    }
    expect(workflowText).toContain('FINAL TRANSACTION PROPOSAL');
    expect(workflowText).toContain('create_docx');
    expect(workflowText).toContain('create_pdf');

    const adapterText = fs.readFileSync(path.join(teamRoot, 'adapter.md'), 'utf8');
    expect(adapterText).toContain('Skill 注册表');
    expect(adapterText).toContain('禁止用 `find_files`、`grep`、`list_dir`');
    expect(adapterText).toContain('不要再次读取 `SKILL.md` 或');
    expect(adapterText).toContain('聚源在工具箱已配置时会自动启用');
    expect(adapterText).toContain('iFinD → 聚源 MCP → 已有可信数据/官方披露');
    expect(adapterText).toContain('第一次调用必须一次性创建以下 8 个稳定阶段');
    expect(workflowText).toContain('8 个稳定阶段 ID');
  });
});
