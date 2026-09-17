// Keep the task flows available for reactivation while presenting categories as labels.
export function getWelcomeShortcutAvailability() {
  return { interactive: false, showFixedIncome: false };
}
