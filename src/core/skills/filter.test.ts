import { describe, expect, it } from 'vitest';
import { filterAvailableSkillNames, projectUsableSkills, stripUnavailableLeadingSkillMentions } from './filter';

describe('filterAvailableSkillNames', () => {
  it('drops deleted skills from persisted bindings', () => {
    expect(filterAvailableSkillNames(
      ['ifind-finance-data', 'still-installed'],
      ['still-installed'],
    )).toEqual(['still-installed']);
  });

  it('removes deleted leading skill mentions from replayed messages', () => {
    expect(stripUnavailableLeadingSkillMentions(
      '/ifind-finance-data 查一下收入',
      ['still-installed'],
    )).toBe('查一下收入');
  });

  it('keeps builtin slash commands', () => {
    expect(stripUnavailableLeadingSkillMentions('/help', [])).toBe('/help');
  });

  it('keeps builtins global and workspace skills project-scoped', () => {
    expect(projectUsableSkills([
      { name: 'summarize', description: 'builtin', tags: ['builtin'] },
      { name: 'ifind-finance-data', description: 'workspace', tags: ['workspace'] },
      { name: 'other-user-skill', description: 'workspace', tags: ['workspace'] },
    ], ['ifind-finance-data']).map((skill) => skill.name)).toEqual([
      'summarize',
      'ifind-finance-data',
    ]);
  });
});
