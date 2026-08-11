/**
 * Keep the desktop shell at the same default and minimum size as OpenWorker.
 *
 * OpenWorker defines these values in:
 * surfaces/gui/src-tauri/src/lib.rs
 *   .inner_size(1360.0, 900.0)
 *   .min_inner_size(980.0, 640.0)
 *
 * Keeping the values in a side-effect-free module makes the Electron window
 * contract testable without importing the main-process bootstrap.
 */
export const MAIN_WINDOW_BOUNDS = Object.freeze({
  width: 1360,
  height: 900,
  minWidth: 980,
  minHeight: 640,
});

export const MAIN_WINDOW_BACKGROUND = '#fbfaf7';
export const MACOS_TITLE_BAR_HEIGHT = 48;
export const WINDOWS_TITLE_BAR_HEIGHT = 40;
export const WINDOWS_TITLE_BAR_LIGHT = Object.freeze({
  color: '#f7f6f2',
  symbolColor: '#29261b',
});
export const WINDOWS_TITLE_BAR_DARK = Object.freeze({
  color: '#242424',
  symbolColor: '#f3f0e8',
});

const MACOS_WINDOW_CHROME = Object.freeze({
  titleBarStyle: 'hidden' as const,
  titleBarOverlay: Object.freeze({
    height: MACOS_TITLE_BAR_HEIGHT,
  }),
  trafficLightPosition: Object.freeze({
    x: 16,
    y: 17,
  }),
});

const WINDOWS_WINDOW_CHROME = Object.freeze({
  titleBarStyle: 'hidden' as const,
  titleBarOverlay: Object.freeze({
    ...WINDOWS_TITLE_BAR_LIGHT,
    height: WINDOWS_TITLE_BAR_HEIGHT,
  }),
});

/**
 * macOS shares the renderer title bar with the traffic lights. Windows keeps
 * its native minimise/maximise/close buttons in a title-bar overlay while the
 * renderer owns the rest of the row. Linux retains the native title bar.
 */
export function getMainWindowChrome(
  platform: string,
): typeof MACOS_WINDOW_CHROME | typeof WINDOWS_WINDOW_CHROME | Record<string, never> {
  if (platform === 'darwin') return MACOS_WINDOW_CHROME;
  if (platform === 'win32') return WINDOWS_WINDOW_CHROME;
  return {};
}
