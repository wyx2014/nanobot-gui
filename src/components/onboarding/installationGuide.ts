export function shouldShowInstallationGuide(options: {
  guideShown: boolean;
  guideOpen: boolean;
  completedInstallationId: string;
  currentInstallationId: string;
}): boolean {
  return options.guideOpen
    || !options.guideShown
    || options.completedInstallationId !== options.currentInstallationId;
}
