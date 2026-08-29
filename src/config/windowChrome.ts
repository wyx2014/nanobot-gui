/**
 * Shared renderer/main-process window chrome dimensions.
 *
 * Windows and Linux caption buttons are native and always render above web
 * contents, so renderer-owned overlays begin below their shared title-bar row.
 */
export const MACOS_TITLE_BAR_HEIGHT = 48;
export const WINDOWS_TITLE_BAR_HEIGHT = 36;
export const LINUX_TITLE_BAR_HEIGHT = 48;

export function rendererTitlebarSafeTop(platform: string): number {
  if (platform === 'windows' || platform === 'win32') return WINDOWS_TITLE_BAR_HEIGHT;
  if (platform === 'linux') return LINUX_TITLE_BAR_HEIGHT;
  return 0;
}
