import type { SkillMetadata } from '@/types';

export function filterAvailableSkillNames(names: string[], availableNames: Iterable<string>): string[] {
  const available = new Set(availableNames);
  return names.filter((name) => available.has(name));
}

export function projectUsableSkills(
  skills: SkillMetadata[],
  projectGrantedSkillNames: Iterable<string>,
): SkillMetadata[] {
  const granted = new Set(projectGrantedSkillNames);
  return skills.filter((skill) => skill.tags?.[0] !== 'workspace' || granted.has(skill.name));
}

const BUILTIN_SLASH_COMMANDS = new Set([
  'dream',
  'dream-log',
  'dream-restore',
  'goal',
  'help',
  'history',
  'model',
  'new',
  'pairing',
  'restart',
  'skill',
  'status',
  'stop',
]);

export function stripUnavailableLeadingSkillMentions(text: string, availableNames: Iterable<string>): string {
  const available = new Set(availableNames);
  const tokens = text.match(/^(\s*\/[A-Za-z0-9][A-Za-z0-9_-]{0,63})+/)?.[0] ?? '';
  if (!tokens) return text;

  const kept = tokens
    .trim()
    .split(/\s+/)
    .filter((token) => {
      const name = token.slice(1);
      return available.has(name) || BUILTIN_SLASH_COMMANDS.has(name);
    });

  return [kept.join(' '), text.slice(tokens.length).trimStart()].filter(Boolean).join(' ');
}
