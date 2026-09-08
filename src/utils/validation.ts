/** Regex for valid skill/agent names: lowercase alphanumeric, hyphens allowed (not at start/end) */
export const ITEM_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Matches gateway skill IDs, including versioned directory names. */
export const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function normalizeSkillName(value: string): string {
  const trimmed = value.trim();
  if (SKILL_NAME_RE.test(trimmed)) return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}
