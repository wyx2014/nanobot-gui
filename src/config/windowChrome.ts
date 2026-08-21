/**
 * Shared renderer/main-process window chrome dimensions.
 *
 * Windows caption buttons are native and always render above web contents, so
 * every renderer-owned modal and notification must begin below this row.
 */
export const MACOS_TITLE_BAR_HEIGHT = 48;
export const WINDOWS_TITLE_BAR_HEIGHT = 36;

export function rendererTitlebarSafeTop(platform: string): number {
  return platform === 'windows' || platform === 'win32' ? WINDOWS_TITLE_BAR_HEIGHT : 0;
}
