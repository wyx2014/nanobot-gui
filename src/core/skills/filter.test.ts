import { describe, expect, it } from 'vitest';
import { stripUnavailableLeadingSkillMentions, usableSkillsForScope } from './filter';

describe('versioned skill mentions', () => {
  it('preserves the complete available name and removes an unavailable version', () => {
    expect(stripUnavailableLeadingSkillMentions(
      '/libai-1.0.3 /libai-1.0.4 润色这段文字', ['libai-1.0.4'],
    )).toBe('/libai-1.0.4 润色这段文字');
    expect(stripUnavailableLeadingSkillMentions('/libai-1.0.4 润色', [])).toBe('润色');
  });

  it('does not interpret a prefix as another skill or alter ordinary slash paths', () => {
    expect(stripUnavailableLeadingSkillMentions('/libai-1.0.4 润色', ['libai-1'])).toBe('润色');
    expect(stripUnavailableLeadingSkillMentions('/tmp/example.txt', [])).toBe('/tmp/example.txt');
    expect(stripUnavailableLeadingSkillMentions('/help', [])).toBe('/help');
  });

  it('keeps project grants scoped to the exact version', () => {
    const skills = ['libai-1.0.3', 'libai-1.0.4'].map((name) => ({ name, description: '', tags: ['workspace'] }));
    expect(usableSkillsForScope(skills, null, [])).toEqual(skills);
    expect(usableSkillsForScope(skills, '/project', ['libai-1.0.4'])).toEqual([skills[1]]);
  });
});
