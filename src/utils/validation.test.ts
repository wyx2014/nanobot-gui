import { expect, it } from 'vitest';
import { normalizeSkillName, SKILL_NAME_RE } from './validation';

it.each(['libai-1.0.4', 'libai-1.0.4-beta.1', 'LiBai_v1.0.4'])(
  'preserves the versioned skill identifier %s in import and creation', (name) => {
    expect(normalizeSkillName(name)).toBe(name);
    expect(SKILL_NAME_RE.test(name)).toBe(true);
  },
);

it.each(['.', '..', '../libai', 'libai/../../outside', 'libai\\..\\outside', '/tmp/libai', 'a'.repeat(65)])(
  'rejects invalid skill paths: %s', (name) => {
    expect(SKILL_NAME_RE.test(name)).toBe(false);
  },
);
