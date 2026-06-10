import { useState } from 'react';
import { ITEM_NAME_RE } from '@/utils/validation';

/**
 * Shared name validation logic for AgentEditor and SkillEditor.
 * Handles the "new vs rename vs unchanged" validation rules:
 * - New item or renamed: strict ITEM_NAME_RE check
 * - Unchanged name on existing item: always valid
 */
export function useItemName(existingName: string | null) {
  const [name, setRawName] = useState(existingName ?? '');

  const setName = (value: string) => {
    setRawName(value.replace(/\s+/g, '-').toLowerCase());
  };

  const trimmed = name.trim();
  const isNew = existingName === null;
  const nameChanged = !isNew && trimmed !== existingName;
  const nameValid = trimmed.length > 0 && (
    (isNew || nameChanged) ? ITEM_NAME_RE.test(trimmed) : true
  );

  return { name, setName, nameValid, nameChanged } as const;
}
