import { describe, expect, it } from 'vitest';
import { getAutomationTemplates } from './automationTemplates';

describe('automation templates', () => {
  it.each(['zh-CN', 'en-US'] as const)('provides complete, gateway-compatible drafts for %s', (locale) => {
    const templates = getAutomationTemplates(locale);

    expect(templates).toHaveLength(6);
    expect(new Set(templates.map((template) => template.id)).size).toBe(templates.length);

    for (const template of templates) {
      expect(template.draft.name.trim().length).toBeGreaterThan(0);
      expect(template.draft.description?.trim().length).toBeGreaterThan(0);
      expect(template.draft.prompt.trim().length).toBeGreaterThan(20);
      expect(['hourly', 'daily', 'weekly', 'monthly', 'weekdays', 'manual']).toContain(
        template.draft.schedule.frequency,
      );

      if (template.draft.schedule.frequency === 'weekly') {
        expect(template.draft.schedule.dayOfWeek).toBeGreaterThanOrEqual(0);
        expect(template.draft.schedule.dayOfWeek).toBeLessThanOrEqual(6);
      }

      if (template.draft.schedule.frequency === 'monthly') {
        expect(template.draft.schedule.dayOfMonth).toBeGreaterThanOrEqual(1);
        expect(template.draft.schedule.dayOfMonth).toBeLessThanOrEqual(31);
      }
    }
  });

  it('contains only the six office-focused templates in the requested order', () => {
    const templates = getAutomationTemplates('zh-CN');

    expect(templates.map((template) => template.draft.name)).toEqual([
      '每周工作周报',
      '每日工作晨间简报',
      '每日 AI 新闻推送',
      '月度工作复盘',
      '知识沉淀助手',
      '每日邮件待办提取',
    ]);
    expect(templates.map((template) => template.id)).toEqual([
      'weekly-work-report',
      'daily-morning-work-brief',
      'ai-daily-brief',
      'monthly-work-review',
      'knowledge-capture-assistant',
      'daily-email-todo-extractor',
    ]);
  });

  it('keeps locale variants aligned by template id and schedule', () => {
    const chinese = getAutomationTemplates('zh-CN');
    const english = getAutomationTemplates('en-US');

    expect(english.map((template) => template.id)).toEqual(
      chinese.map((template) => template.id),
    );
    expect(english.map((template) => template.draft.schedule)).toEqual(
      chinese.map((template) => template.draft.schedule),
    );
  });
});
