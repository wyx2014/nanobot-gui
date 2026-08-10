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

/**
 * macOS needs a full-size content window so the renderer title bar can share
 * the same row as the native traffic lights. Other platforms retain their
 * native title bars and window controls.
 */
export function getMainWindowChrome(platform: string): typeof MACOS_WINDOW_CHROME | Record<string, never> {
  return platform === 'darwin' ? MACOS_WINDOW_CHROME : {};
}
