import { describe, expect, it } from 'vitest';
import { shouldShowInstallationGuide } from './installationGuide';

describe('installation-scoped onboarding', () => {
  it('stays dismissed during repeated launches of the same installation', () => {
    expect(shouldShowInstallationGuide({
      guideShown: true,
      guideOpen: false,
      completedInstallationId: 'install-a',
      currentInstallationId: 'install-a',
    })).toBe(false);
  });

  it('returns after uninstall and reinstall changes the installation ID', () => {
    expect(shouldShowInstallationGuide({
      guideShown: true,
      guideOpen: false,
      completedInstallationId: 'install-a',
      currentInstallationId: 'install-b',
    })).toBe(true);
  });

  it('still supports opening the guide manually', () => {
    expect(shouldShowInstallationGuide({
      guideShown: true,
      guideOpen: true,
      completedInstallationId: 'install-a',
      currentInstallationId: 'install-a',
    })).toBe(true);
  });
});
