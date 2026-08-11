const TITLEBAR_EDGE_GAP = 12;
const TITLEBAR_CONTROL_SIZE = 28;
const TITLEBAR_CONTROL_GAP = 4;
const TITLEBAR_CONTROL_COUNT = 3;
const SIDEBAR_WIDTH = 260;

export interface TitlebarLayoutInput {
  isMac: boolean;
  isWindows: boolean;
  isFullScreen: boolean;
  sidebarCollapsed: boolean;
  sidebarVisible: boolean;
}

export interface TitlebarLayout {
  navigationLeft: number;
  conversationLeadingInset: number;
}

/**
 * Keep the app navigation and the conversation identity on one title-bar row.
 * Coordinates are returned relative to the window for navigation and relative
 * to the main content column for the conversation header.
 */
export function resolveTitlebarLayout({
  isMac,
  isWindows,
  isFullScreen,
  sidebarCollapsed,
  sidebarVisible,
}: TitlebarLayoutInput): TitlebarLayout {
  const navigationLeft = isFullScreen
    ? TITLEBAR_EDGE_GAP
    : isMac
      ? 92
      : isWindows
        ? TITLEBAR_EDGE_GAP
        : sidebarCollapsed
          ? 70
          : 232;
  const navigationWidth = (
    TITLEBAR_CONTROL_COUNT * TITLEBAR_CONTROL_SIZE
    + (TITLEBAR_CONTROL_COUNT - 1) * TITLEBAR_CONTROL_GAP
  );
  const mainContentLeft = sidebarVisible ? SIDEBAR_WIDTH : 0;
  const conversationLeadingInset = isWindows
    ? TITLEBAR_EDGE_GAP
    : Math.max(
      TITLEBAR_EDGE_GAP,
      navigationLeft + navigationWidth + TITLEBAR_EDGE_GAP - mainContentLeft,
    );

  return { navigationLeft, conversationLeadingInset };
}
