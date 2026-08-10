// Shared conversation/panel geometry. Keeping these constants in a tiny
// module prevents the lazily loaded chat view from pulling in RightPanel and
// its preview renderers just to calculate an inset.
export const PINNED_SUMMARY_WIDTH = 288;
export const PINNED_SUMMARY_RIGHT = 8;
export const PINNED_SUMMARY_GAP = 8;
export const PINNED_SUMMARY_CONTENT_INSET =
  PINNED_SUMMARY_WIDTH + PINNED_SUMMARY_RIGHT + PINNED_SUMMARY_GAP;
export const PINNED_SUMMARY_CONTENT_MAX_WIDTH = 768;
