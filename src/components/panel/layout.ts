// Shared conversation/panel geometry. Keeping these constants in a tiny
// module prevents the lazily loaded chat view from pulling in RightPanel and
// its preview renderers just to calculate an inset.
export const PINNED_SUMMARY_WIDTH = 288;
export const PINNED_SUMMARY_RIGHT = 8;
export const PINNED_SUMMARY_GAP = 8;
export const PINNED_SUMMARY_CONTENT_INSET =
  PINNED_SUMMARY_WIDTH + PINNED_SUMMARY_RIGHT + PINNED_SUMMARY_GAP;
export const PINNED_SUMMARY_CONTENT_MAX_WIDTH = 896;
export const CONVERSATION_SIDEBAR_WIDTH = 260;

// Below this effective CSS viewport width there is not enough room for the
// navigation sidebar, a full-width conversation column and the pinned summary
// at the same time. This is especially common on 1920px Windows displays using
// 150% scaling, where Electron receives an effective width near 1280px.
export const PINNED_SUMMARY_COMPACT_MAX_WIDTH =
  CONVERSATION_SIDEBAR_WIDTH
  + PINNED_SUMMARY_CONTENT_INSET
  + PINNED_SUMMARY_CONTENT_MAX_WIDTH
  - 1;
export const PINNED_SUMMARY_COMPACT_MEDIA_QUERY =
  `(max-width: ${PINNED_SUMMARY_COMPACT_MAX_WIDTH}px)`;

// Messages and the composer must share one outer conversation column. The
// composer stays slightly narrower while the summary is pinned, but is
// centered inside that column instead of drifting toward the summary rail.
export function getConversationColumnClasses(summaryPinned: boolean): {
  outer: string;
  composer: string;
} {
  return {
    outer: summaryPinned
      ? 'w-full max-w-4xl ml-auto mr-0'
      : 'w-full max-w-4xl mx-auto',
    composer: summaryPinned
      ? 'w-full max-w-3xl mx-auto'
      : 'w-full',
  };
}

export function shouldAutoHideSidebarForPinnedSummary({
  windows,
  compactViewport,
  chatVisible,
  hasActiveConversation,
  summaryCollapsed,
  previewOpen,
  browserOpen,
}: {
  windows: boolean;
  compactViewport: boolean;
  chatVisible: boolean;
  hasActiveConversation: boolean;
  summaryCollapsed: boolean;
  previewOpen: boolean;
  browserOpen: boolean;
}): boolean {
  return windows
    && compactViewport
    && chatVisible
    && hasActiveConversation
    && !summaryCollapsed
    && !previewOpen
    && !browserOpen;
}
