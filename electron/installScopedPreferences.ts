export interface WindowPreferences {
  closeToTrayNoticeSeen?: unknown;
  closeToTrayNoticeInstallationId?: unknown;
}

export function hasSeenCloseToTrayNoticeForInstallation(
  preferences: WindowPreferences,
  installationId: string,
): boolean {
  return preferences.closeToTrayNoticeSeen === true
    && preferences.closeToTrayNoticeInstallationId === installationId;
}

export function closeToTrayNoticePreferences(installationId: string): WindowPreferences {
  return {
    closeToTrayNoticeSeen: true,
    closeToTrayNoticeInstallationId: installationId,
  };
}
