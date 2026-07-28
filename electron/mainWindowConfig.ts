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
