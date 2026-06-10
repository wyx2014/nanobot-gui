import { describe, it, expect } from 'vitest';
import {
  parseExecutionPlan,
  matchToolToStep,
  textStartsWithPlan,
  extractPlanFromStart,
} from './taskStepParser';

describe('taskStepParser (core/agent)', () => {
  // ── JSON plan parsing ──
  describe('parseExecutionPlan — JSON format', () => {
    it('parses valid JSON plan', () => {
      const text = '好的，我来处理。{"plan": ["读取文件", "分析内容", "输出结果"]}';
      const result = parseExecutionPlan(text);
      expect(result.format).toBe('json');
      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].description).toBe('读取文件');
      expect(result.steps[0].index).toBe(1);
      expect(result.steps[0].status).toBe('pending');
    });

    it('returns empty for invalid JSON', () => {
      const text = '{"plan": [invalid]}';
      const result = parseExecutionPlan(text);
      expect(result.steps).toHaveLength(0);
    });

    it('trims whitespace in step descriptions', () => {
      const text = '{"plan": ["  step one  ", " step two "]}';
      const result = parseExecutionPlan(text);
      expect(result.steps[0].description).toBe('step one');
      expect(result.steps[1].description).toBe('step two');
    });
  });

  // ── Markdown plan parsing ──
  describe('parseExecutionPlan — Markdown format', () => {
    it('parses ## 执行计划 with numbered list', () => {
      const text = `## 执行计划
1. 读取配置文件
2. 修改参数
3. 保存并验证`;
      const result = parseExecutionPlan(text);
      expect(result.format).toBe('markdown');
      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].description).toBe('读取配置文件');
      expect(result.steps[2].description).toBe('保存并验证');
    });

    it('parses # 执行计划 (single hash)', () => {
      const text = `# 执行计划
1. Step A
2. Step B`;
      const result = parseExecutionPlan(text);
      expect(result.steps).toHaveLength(2);
    });

    it('parses 执行计划 without hash', () => {
      const text = `执行计划
1. Step A
2. Step B`;
      const result = parseExecutionPlan(text);
      expect(result.steps).toHaveLength(2);
    });

    it('parses 执行计划：with colon', () => {
      const text = `执行计划：
1. Step A
2. Step B`;
      const result = parseExecutionPlan(text);
      expect(result.steps).toHaveLength(2);
    });

    it('parses bullet points (- style)', () => {
      const text = `## 执行计划
- 查看目录
- 读取文件
- 运行测试`;
      const result = parseExecutionPlan(text);
      expect(result.steps).toHaveLength(3);
    });

    it('parses Chinese numbered format (1、)', () => {
      // The step regex is /^(?:\d+[.、]|[-*])\s+(.+)$/gm — note the space after 、
      const text = `## 执行计划
1、 查看目录
2、 读取文件`;
      const result = parseExecutionPlan(text);
      expect(result.steps).toHaveLength(2);
    });

    it('stops at next ## section', () => {
      const text = `## 执行计划
1. Step A
2. Step B

## 注意事项
这里不应被解析`;
      const result = parseExecutionPlan(text);
      expect(result.steps).toHaveLength(2);
    });

    it('returns none for text without plan', () => {
      const result = parseExecutionPlan('这是一段普通文本，没有执行计划。');
      expect(result.format).toBe('none');
      expect(result.steps).toHaveLength(0);
    });
  });

  // ── matchToolToStep ──
  describe('matchToolToStep', () => {
    const steps = [
      { index: 1, description: '读取 config.json 文件', status: 'pending' as const },
      { index: 2, description: '执行 npm install 命令', status: 'pending' as const },
      { index: 3, description: '搜索 error 关键词', status: 'pending' as const },
    ];

    it('matches read_file to step with 读取', () => {
      const match = matchToolToStep('read_file', { path: '/app/config.json' }, steps);
      expect(match).toBe(1);
    });

    it('matches run_command to step with 执行', () => {
      const match = matchToolToStep('run_command', { command: 'npm install' }, steps);
      expect(match).toBe(2);
    });

    it('matches web_search to step with 搜索', () => {
      const match = matchToolToStep('web_search', { query: 'error' }, steps);
      expect(match).toBe(3);
    });

    it('returns first pending step when no keyword match', () => {
      const match = matchToolToStep('unknown_tool', {}, steps);
      expect(match).toBe(1);
    });

    it('returns null when no pending steps', () => {
      const completed = steps.map((s) => ({ ...s, status: 'completed' as const }));
      const match = matchToolToStep('read_file', {}, completed);
      expect(match).toBeNull();
    });

    it('skips completed steps', () => {
      const mixed = [
        { ...steps[0], status: 'completed' as const },
        steps[1],
        steps[2],
      ];
      const match = matchToolToStep('read_file', { path: '/app/config.json' }, mixed);
      // Should match step 2 or 3 (not step 1 which is completed)
      expect(match).not.toBe(1);
    });
  });

  // ── textStartsWithPlan ──
  describe('textStartsWithPlan', () => {
    it('detects markdown plan header', () => {
      expect(textStartsWithPlan('## 执行计划\n1. Step')).toBe(true);
    });

    it('detects JSON plan start', () => {
      expect(textStartsWithPlan('{"plan": ["step1"]}')).toBe(true);
    });

    it('rejects non-plan text', () => {
      expect(textStartsWithPlan('Hello world')).toBe(false);
    });

    it('handles leading whitespace', () => {
      expect(textStartsWithPlan('  ## 执行计划\n1. Step')).toBe(true);
    });
  });

  // ── extractPlanFromStart ──
  describe('extractPlanFromStart', () => {
    it('extracts plan and remaining text', () => {
      const text = `## 执行计划
1. Step A
2. Step B

## 详细说明
接下来我来执行这些步骤。`;
      const result = extractPlanFromStart(text);
      expect(result).not.toBeNull();
      expect(result!.plan.steps).toHaveLength(2);
      // The remaining text is after the plan rawText
      expect(result!.remainingText.length).toBeGreaterThan(0);
    });

    it('returns null for non-plan text', () => {
      const result = extractPlanFromStart('这是普通文本');
      expect(result).toBeNull();
    });
  });
});
