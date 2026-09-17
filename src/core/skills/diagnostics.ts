/** Counts only: skill names, contents, paths and credentials stay out of logs. */
export function skillCatalogCounts(payload: unknown): Record<string, number | string> {
  const skills = payload && typeof payload === 'object'
    ? (payload as { skills?: unknown }).skills : undefined;
  if (!Array.isArray(skills)) return { error_code: 'SKILLS_ARRAY_MISSING' };

  const counts = {
    count: skills.length, workspace_count: 0, eligible_count: 0,
    disabled_count: 0, unavailable_count: 0, non_invocable_count: 0,
    invalid_entry_count: 0, invalid_tags_count: 0,
  };
  for (const skill of skills) {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) {
      counts.invalid_entry_count++;
      continue;
    }
    if (skill.source === 'workspace') counts.workspace_count++;
    if (!skill.enabled) counts.disabled_count++;
    if (!skill.available) counts.unavailable_count++;
    if (skill.user_invocable === false) counts.non_invocable_count++;
    if (skill.enabled && skill.available && skill.user_invocable !== false) {
      counts.eligible_count++;
      if (!Array.isArray(skill.tags)) counts.invalid_tags_count++;
    }
  }
  return counts;
}
