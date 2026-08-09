import type { SkillMetadata } from '@/types';

/** Display label for a skill name. The underlying identifier stays unchanged
 * (e.g. "clawhub" is sent to the gateway), but the UI shows a friendlier
 * name so the toolbox and the composer "+" menu stay consistent. */
export function displaySkillName(name: string): string {
  return name === 'clawhub' ? 'TPACoworkHub' : name;
}

/**
 * Filter skills usable in a conversation. Project workspaces apply skill
 * permission control (only bound workspace skills are usable); conversations
 * outside a project have no permission model, so every skill (builtin + my
 * skills) stays available.
 */
export function usableSkillsForScope(
  skills: SkillMetadata[],
  activeProjectPath: string | null,
  projectGrantedSkillNames: Iterable<string>,
): SkillMetadata[] {
  if (!activeProjectPath) return skills;
  const granted = new Set(projectGrantedSkillNames);
  return skills.filter((skill) => skill.tags?.[0] !== 'workspace' || granted.has(skill.name));
}

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
