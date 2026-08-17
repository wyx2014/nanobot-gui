import { describe, expect, it } from 'vitest';
import {
  closeToTrayNoticePreferences,
  hasSeenCloseToTrayNoticeForInstallation,
} from './installScopedPreferences';

describe('installation-scoped close-to-tray notice', () => {
  it('is suppressed after it was shown in the current installation', () => {
    expect(hasSeenCloseToTrayNoticeForInstallation(
      closeToTrayNoticePreferences('install-a'),
      'install-a',
    )).toBe(true);
  });

  it('is shown again after uninstall and reinstall', () => {
    expect(hasSeenCloseToTrayNoticeForInstallation(
      closeToTrayNoticePreferences('install-a'),
      'install-b',
    )).toBe(false);
  });

  it('does not treat the legacy permanent flag as installation-scoped', () => {
    expect(hasSeenCloseToTrayNoticeForInstallation(
      { closeToTrayNoticeSeen: true },
      'install-a',
    )).toBe(false);
  });
});
