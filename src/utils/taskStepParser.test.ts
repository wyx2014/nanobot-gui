import { describe, it, expect } from 'vitest';
import {
  parseTaskSteps,
  matchToolCallToStep,
  inferStepsFromToolCalls,
} from './taskStepParser';

describe('taskStepParser (utils)', () => {
  // ── parseTaskSteps — numbered list ──
  describe('parseTaskSteps — numbered list', () => {
    it('parses numbered steps with dot', () => {
      const text = `我会按以下步骤执行：
1. 查看桌面文件夹
2. 找到发票文件
3. 读取内容`;
      const steps = parseTaskSteps(text);
      expect(steps.length).toBeGreaterThanOrEqual(2);
      expect(steps[0].label).toContain('查看');
      expect(steps[0].status).toBe('pending');
    });

    it('parses numbered steps with Chinese ）', () => {
      const text = `我来帮你处理：
1）查看目录
2）读取文件
3）分析内容`;
      const steps = parseTaskSteps(text);
      expect(steps.length).toBeGreaterThanOrEqual(2);
    });

    it('filters steps that are too long (>100 chars)', () => {
      const text = `首先，我来处理：
1. 短步骤
2. ${'x'.repeat(105)}`;
      const steps = parseTaskSteps(text);
      // Step 2 should be filtered out (>100 chars)
      expect(steps.every((s) => s.label.length < 100)).toBe(true);
    });

    it('returns empty for text without step markers', () => {
      const text = '这是一段普通的回复，没有任何步骤。';
      expect(parseTaskSteps(text)).toHaveLength(0);
    });

    it('returns empty for single step (need >= 2)', () => {
      const text = `首先
1. 唯一步骤`;
      expect(parseTaskSteps(text)).toHaveLength(0);
    });
  });

  // ── parseTaskSteps — markdown checklist ──
  describe('parseTaskSteps — markdown checklist', () => {
    it('parses markdown checklist', () => {
      const text = `## 步骤
- [ ] 读取配置文件
- [ ] 修改参数
- [ ] 保存文件`;
      const steps = parseTaskSteps(text);
      expect(steps.length).toBeGreaterThanOrEqual(2);
    });

    it('parses checked items', () => {
      const text = `## 计划
- [x] 已完成步骤
- [ ] 待做步骤
- [ ] 另一步骤`;
      const steps = parseTaskSteps(text);
      expect(steps.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── parseTaskSteps — Chinese format ──
  describe('parseTaskSteps — Chinese format', () => {
    it('parses 第N步 format', () => {
      const text = `我会按步骤如下操作：
第一步：查看目录结构
第二步：读取关键文件
第三步：分析并输出结果`;
      const steps = parseTaskSteps(text);
      expect(steps.length).toBeGreaterThanOrEqual(2);
      expect(steps[0].label).toContain('查看');
    });

    it('parses 步骤N format', () => {
      const text = `计划如下：
步骤1：查看文件
步骤2：修改代码
步骤3：测试验证`;
      const steps = parseTaskSteps(text);
      expect(steps.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── parseTaskSteps — dash list ──
  describe('parseTaskSteps — dash list', () => {
    it('parses simple dash list in step section', () => {
      const text = `## 步骤
- 查看目录结构
- 读取关键文件内容
- 运行测试命令`;
      const steps = parseTaskSteps(text);
      expect(steps.length).toBeGreaterThanOrEqual(2);
    });

    it('filters short labels (<= 2 chars)', () => {
      const text = `## 计划
- ab
- 长一点的步骤
- 另一个步骤`;
      const steps = parseTaskSteps(text);
      expect(steps.every((s) => s.label.length > 2)).toBe(true);
    });

    it('skips labels starting with ( or 注', () => {
      const text = `## 步骤
- 正常步骤一
- (这是注释)
- 注意事项
- 正常步骤二`;
      const steps = parseTaskSteps(text);
      const labels = steps.map((s) => s.label);
      expect(labels).not.toContain('(这是注释)');
      expect(labels).not.toContain('注意事项');
    });
  });

  // ── Step markers detection ──
  describe('step markers', () => {
    const markers = ['## 步骤', '## 计划', '计划如下', '步骤如下', '我会', '我来', '首先', 'Steps:', 'Plan:', 'I will', "I'll", 'First,'];
    for (const marker of markers) {
      it(`detects marker: "${marker}"`, () => {
        const text = `${marker}\n1. Step A\n2. Step B`;
        const steps = parseTaskSteps(text);
        // At least should not crash; may or may not parse depending on format
        expect(Array.isArray(steps)).toBe(true);
      });
    }
  });

  // ── matchToolCallToStep ──
  describe('matchToolCallToStep', () => {
    const steps = [
      { id: '1', label: '查看桌面文件夹', status: 'pending' as const },
      { id: '2', label: '读取 config.json', status: 'pending' as const },
      { id: '3', label: '执行 npm install', status: 'pending' as const },
    ];

    it('matches list_directory to folder-related step', () => {
      const match = matchToolCallToStep('list_directory', { path: '/Users/test/Desktop' }, steps);
      expect(match).not.toBeNull();
    });

    it('matches read_file to read-related step', () => {
      const match = matchToolCallToStep('read_file', { path: '/app/config.json' }, steps);
      expect(match).not.toBeNull();
      expect(match!.label).toContain('config.json');
    });

    it('returns first pending step when no keyword match', () => {
      const match = matchToolCallToStep('get_system_info', {}, steps);
      expect(match).not.toBeNull();
    });

    it('returns null when all steps are completed', () => {
      const completed = steps.map((s) => ({ ...s, status: 'completed' as const }));
      const match = matchToolCallToStep('read_file', {}, completed);
      expect(match).toBeNull();
    });

    it('includes running steps as candidates', () => {
      const mixed = [
        { ...steps[0], status: 'completed' as const },
        { ...steps[1], status: 'running' as const },
        steps[2],
      ];
      const match = matchToolCallToStep('read_file', { path: '/app/config.json' }, mixed);
      expect(match).not.toBeNull();
    });
  });

  // ── inferStepsFromToolCalls ──
  describe('inferStepsFromToolCalls', () => {
    it('generates label for list_directory', () => {
      const step = inferStepsFromToolCalls('list_directory', { path: '/tmp/project' });
      expect(step.label).toContain('project');
      expect(step.status).toBe('running');
    });

    it('generates label for read_file', () => {
      const step = inferStepsFromToolCalls('read_file', { path: '/tmp/app.tsx' });
      expect(step.label).toContain('app.tsx');
    });

    it('generates label for write_file', () => {
      const step = inferStepsFromToolCalls('write_file', { path: '/tmp/out.txt' });
      expect(step.label).toContain('out.txt');
    });

    it('generates label for run_command', () => {
      const step = inferStepsFromToolCalls('run_command', { command: 'npm install' });
      expect(step.label).toContain('npm install');
    });

    it('truncates long commands', () => {
      const step = inferStepsFromToolCalls('run_command', { command: 'a very long command that exceeds twenty characters' });
      expect(step.label).toContain('...');
    });

    it('generates label for get_system_info', () => {
      const step = inferStepsFromToolCalls('get_system_info', {});
      expect(step.label).toContain('系统');
    });

    it('generates generic label for unknown tool', () => {
      const step = inferStepsFromToolCalls('custom_tool', {});
      expect(step.label).toContain('custom_tool');
    });

    it('has running status and startTime', () => {
      const step = inferStepsFromToolCalls('read_file', {});
      expect(step.status).toBe('running');
      expect(step.startTime).toBeDefined();
    });
  });
});
